import { DateTime } from 'luxon';
import { minutes, cohortStart, meetingFits, generateSchedule, scheduleConflicts } from './scheduling.js';

const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// Each candidate represents one weekly hour across four concrete dates. Cache
// membership of these sets, then intersect them instead of evaluating all pairs
// of schedules against every person. Queue order remains stable and deterministic.
function recurringWindows(anchor, now) {
  const monday = DateTime.fromISO(cohortStart(anchor.timezone, now), { zone: anchor.timezone });
  const windows = [];
  for (const interval of anchor.availability) {
    for (let minute = minutes(interval.start); minute + 60 <= minutes(interval.end, true); minute += 30) {
      const slot = { day: interval.day, start: clock(minute) };
      const meetings = [];
      for (let week = 1; week <= 4; week++) {
        const start = monday.plus({ weeks: week - 1, days: slot.day - 1 }).set({ hour: Math.floor(minute / 60), minute: minute % 60 });
        if (!start.isValid || start.hour !== Math.floor(minute / 60) || start.minute !== minute % 60 || start.getPossibleOffsets().length !== 1) break;
        meetings.push({ week, startsAt: start.toUTC().toISO(), windowEndsAt: start.plus({ minutes: 60 }).toUTC().toISO() });
      }
      if (meetings.length === 4 && meetings.every(meeting => meetingFits(anchor, meeting))) windows.push({ slot, meetings });
    }
  }
  return windows.sort((a, b) => a.slot.day - b.slot.day || a.slot.start.localeCompare(b.slot.start));
}

function separateLocalDays(profile, first, second) {
  return first.meetings.every((meeting, i) => DateTime.fromISO(meeting.startsAt).setZone(profile.timezone).toISODate() !== DateTime.fromISO(second.meetings[i].startsAt).setZone(profile.timezone).toISODate());
}

export function hasSeparateMeetingDays(profile, meetings) {
  return [1, 2, 3, 4].every(week => {
    const dates = meetings.filter(meeting => meeting.week === week).map(meeting => DateTime.fromISO(meeting.startsAt).setZone(profile.timezone).toISODate());
    return dates.length === 2 && new Set(dates).size === 2;
  });
}

export function findAutomaticGroup(profiles, now = new Date()) {
  if (profiles.length < 3) return null;
  const fitsCache = new Map();
  const windowsCache = new Map();
  const signatures = new Map(profiles.map(profile => [profile.id, JSON.stringify([profile.timezone, profile.availability])]));
  function fits(profile, window) {
    const key = `${signatures.get(profile.id)}:${window.meetings.map(m => m.startsAt).join(',')}`;
    if (!fitsCache.has(key)) fitsCache.set(key, window.meetings.every(meeting => meetingFits(profile, meeting)));
    return fitsCache.get(key);
  }
  for (const anchor of profiles) {
    const anchorSignature = signatures.get(anchor.id);
    if (!windowsCache.has(anchorSignature)) windowsCache.set(anchorSignature, recurringWindows(anchor, now));
    const supported = windowsCache.get(anchorSignature).map(window => ({ ...window, supporters: profiles.filter(profile => fits(profile, window)) })).filter(window => window.supporters.length >= 3);
    for (let firstIndex = 0; firstIndex < supported.length; firstIndex++) {
      const first = supported[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < supported.length; secondIndex++) {
        const second = supported[secondIndex];
        if (first.slot.day === second.slot.day) continue;
        const secondIds = new Set(second.supporters.map(profile => profile.id));
        const eligible = first.supporters.filter(profile => secondIds.has(profile.id) && separateLocalDays(profile, first, second));
        if (eligible.length < 3 || !eligible.some(profile => profile.id === anchor.id)) continue;
        const selected = [anchor, ...eligible.filter(profile => profile.id !== anchor.id)].slice(0, 4);
        const slots = [first.slot, second.slot];
        const schedule = generateSchedule(anchor, slots, now);
        // Keep the shared scheduling validator as the final authority.
        if (selected.some(profile => scheduleConflicts(profile, schedule.meetings).length)) continue;
        return { anchor, participants: selected, schedule };
      }
    }
  }
  return null;
}
