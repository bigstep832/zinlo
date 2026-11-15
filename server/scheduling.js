import { getCity } from './locations.js';
import { DateTime, IANAZone } from 'luxon';
import { trackById, isActiveTrack } from './curricula.js';

export class AppError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const fail = (message, code = 'invalid_input', status = 400) => { throw new AppError(status, message, code); };
export function minutes(value, allowMidnight = false) {
  if (allowMidnight && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):(00|30)$/.test(value)) fail('Use times in 30-minute increments.');
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
}
const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function validateAvailability(input) {
  if (!Array.isArray(input) || input.length > 70 || !input.length) fail('Add availability on at least two different days.');
  const days = new Map();
  for (const item of input) {
    if (!item || !Number.isInteger(item.day) || item.day < 1 || item.day > 7) fail('Choose a valid day of the week.');
    const start = minutes(item.start), end = minutes(item.end, true);
    if (end <= start) fail('Each availability interval must end after it starts. Split overnight availability into two days.');
    if (!days.has(item.day)) days.set(item.day, []);
    days.get(item.day).push([start, end]);
  }
  const merged = [];
  for (const [day, intervals] of [...days].sort((a, b) => a[0] - b[0])) {
    intervals.sort((a, b) => a[0] - b[0]);
    const ranges = [];
    for (const [start, end] of intervals) {
      const last = ranges.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(end, last[1]); else ranges.push([start, end]);
    }
    merged.push(...ranges.map(([start, end]) => ({ day, start: clock(start), end: clock(end) })));
  }
  if (new Set(merged.filter(i => minutes(i.end, true) - minutes(i.start) >= 60).map(i => i.day)).size < 2) fail('Allow at least one complete hour on each of two different days.');
  return merged;
}
export function validateProfile(body, { allowedArchivedTrackId } = {}) {
  if (!body || typeof body !== 'object') fail('Provide your profile.');
  if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 60) fail('Your name must be between 1 and 60 characters.');
  const track = trackById(body.trackId);
  if (!track) fail('Choose a learning track.');
  if (!isActiveTrack(body.trackId) && body.trackId !== allowedArchivedTrackId) fail('This course is archived. Choose one of the available courses.', 'track_archived');
  if (!track.levels.some(level => level.id === body.level)) fail(body.trackId === 'ai' ? 'AI Apps requires basic Python knowledge.' : 'Choose your current preparation level.', body.trackId === 'ai' ? 'prerequisite' : 'invalid_input');
  const city = body.cityId ? getCity(body.cityId) : null;
  if (body.cityId && !city) fail('Choose a city from the search results.');
  if (city) body = { ...body, timezone: city.timezone };
  if (body.learningMode !== undefined && !['solo', 'squad'].includes(body.learningMode)) fail('Choose a learning format.');
  if (typeof body.timezone !== 'string' || body.timezone.length > 100 || !(IANAZone.isValidZone(body.timezone) || body.timezone === 'UTC')) fail('Choose a valid named time zone.');
  return { name: body.name.trim(), trackId: body.trackId, level: body.level, timezone: body.timezone, availability: body.learningMode === 'solo' ? [] : validateAvailability(body.availability), ...(city ? { cityId: city.id, cityLabel: city.label } : {}), ...(body.learningMode ? { learningMode: body.learningMode } : {}) };
}
export function cohortStart(timezone, now = new Date()) {
  return DateTime.fromJSDate(now, { zone: timezone }).startOf('week').plus({ weeks: 1 }).toISODate();
}
export function meetingFits(profile, meeting) {
  if (!profile?.timezone || !Array.isArray(profile.availability)) return false;
  const start = DateTime.fromISO(meeting.startsAt, { zone: 'utc' });
  const end = DateTime.fromISO(meeting.windowEndsAt, { zone: 'utc' });
  if (!start.isValid || !end.isValid || end <= start) return false;
  // Inspect every minute of the actual hour, including day and DST changes.
  for (let stamp = start.toMillis(); stamp < end.toMillis(); stamp += 60000) {
    const local = DateTime.fromMillis(stamp, { zone: profile.timezone });
    const minute = local.hour * 60 + local.minute;
    if (!profile.availability.some(i => i.day === local.weekday && minute >= minutes(i.start) && minute + 1 <= minutes(i.end, true))) return false;
  }
  return true;
}
export function scheduleConflicts(profile, meetings) { return meetings.filter(m => !meetingFits(profile, m)); }
export function generateSchedule(profile, slots, now = new Date()) {
  if (!Array.isArray(slots) || slots.length !== 2 || slots.some(s => !s || !Number.isInteger(s.day) || s.day < 1 || s.day > 7) || slots[0].day === slots[1].day) fail('Choose exactly two meeting windows on different days.');
  slots.forEach(s => minutes(s.start));
  const monday = DateTime.fromISO(cohortStart(profile.timezone, now), { zone: profile.timezone });
  const meetings = [];
  for (let week = 1; week <= 4; week++) for (const slot of slots) {
    const [hour, minute] = slot.start.split(':').map(Number);
    const date = monday.plus({ weeks: week - 1, days: slot.day - 1 });
    const start = date.set({ hour, minute });
    if (!start.isValid || start.hour !== hour || start.minute !== minute || start.getPossibleOffsets().length !== 1) fail('A selected time is missing or ambiguous during a daylight-saving change. Choose another hour.', 'dst_conflict');
    meetings.push({ id: `preview-${week}-${slot.day}`, week, startsAt: start.toUTC().toISO(), endsAt: start.plus({ minutes: 50 }).toUTC().toISO(), windowEndsAt: start.plus({ minutes: 60 }).toUTC().toISO(), topic: `Week ${week} practice` });
  }
  meetings.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (scheduleConflicts(profile, meetings).length) fail('All eight complete meeting windows must fit your availability.', 'incompatible_schedule');
  return { meetings, startDate: meetings[0].startsAt, endDate: DateTime.fromISO(meetings[0].startsAt).setZone(profile.timezone).plus({ weeks: 4 }).toUTC().toISO() };
}
