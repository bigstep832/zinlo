import React from 'react';
import { ArrowRight, BookOpen, Users } from 'lucide-react';

export function MyCourses({ boot, go, dateText }) {
  const courses = boot.activeCourses || [];
  return <div className="my-courses"><div className="page-heading"><div><p className="eyebrow">Your learning space</p><h1>My courses</h1><p>Different skills. Your own rhythm.</p></div><button onClick={() => go('/')}>Explore more courses</button></div>
    {courses.length ? <div className="grid two">{courses.map(course => {
      const next = course.meetings.find(meeting => Date.parse(meeting.endsAt) > Date.now());
      const solo = course.learningMode === 'solo';
      return <article className="panel course-enrollment" key={course.id}><span className="demo-label">{solo ? <BookOpen size={16} aria-hidden="true"/> : <Users size={16} aria-hidden="true"/>}{solo ? 'Independent learning' : `${course.memberCount} teammates`}</span><h2>{course.name}</h2><p>{solo ? 'Your lessons and weekly assignments, at your own study times.' : next ? `Next meeting: ${dateText(next.startsAt, boot.user?.timezone, true)}` : 'Open your squad to see the schedule and next steps.'}</p><button className="primary" onClick={() => go(`/squads/${course.id}`)}>Open {solo ? 'course' : 'squad'} <ArrowRight size={17} aria-hidden="true"/></button></article>;
    })}</div> : <section className="panel"><h2>Your next skill starts here.</h2><p>Choose a course to begin. Completed courses stay in History.</p><button className="primary" onClick={() => go('/')}>Explore courses</button></section>}
    {boot.matchmaking?.status === 'waiting' && <section className="panel"><h2>Your squad search is running.</h2><p>Keep the search page open while we find compatible learners for {boot.tracks.find(track => track.id === boot.user?.trackId)?.title}.</p><button onClick={() => go('/matches')}>Return to search</button></section>}
  </div>;
}
