import { activitySummary } from '../activity.js';

export default function Activity({ data, now }) {
  const activity = activitySummary(data, now);
  const goals = [
    { title: 'Make today’s call', detail: 'Place one simulated prediction.', value: Math.min(activity.todayPredictions, 1), target: 1 },
    { title: 'Explore a second match', detail: 'Predict on two different matches today.', value: Math.min(activity.todayMatches, 2), target: 2 },
  ];
  return <section className="activity-section" aria-labelledby="activity-heading">
    <div className="section-heading"><div><span className="eyebrow">Your journey, day by day</span><h2 id="activity-heading">Keep your course.</h2></div></div>
    <dl className="activity-summary"><div><dt>Prediction streak</dt><dd>{activity.currentStreak} {activity.currentStreak === 1 ? 'day' : 'days'}</dd></div><div><dt>Longest streak</dt><dd>{activity.bestStreak} {activity.bestStreak === 1 ? 'day' : 'days'}</dd></div><div><dt>Winning market streak</dt><dd>{activity.winningStreak}</dd></div></dl>
    <details className="activity-rules"><summary>How streaks work</summary><p className="inline-note">Predict on consecutive UTC days to keep your streak. Yesterday’s streak lasts until today ends. Winning streaks count settled markets with positive net simulated profit; refunds are excluded.</p></details>
    <ol className="activity-week" aria-label="Prediction activity over the last seven UTC days">{activity.week.map(day => <li key={day.date} className={day.active ? 'day-active' : ''} aria-current={day.today ? 'date' : undefined}><time dateTime={day.date}>{day.date.slice(5)}</time><span>{day.active ? 'Predicted' : day.today ? 'Today' : 'No prediction'}</span></li>)}</ol>
    <div className="daily-goals"><h3>Today’s goals</h3>{goals.map(goal => <div className="daily-goal" key={goal.title}><div><strong>{goal.title}</strong><p>{goal.detail}</p></div><span className={goal.value === goal.target ? 'positive' : ''}>{goal.value === goal.target ? 'Completed' : `${goal.value} / ${goal.target}`}</span></div>)}</div>
    <p className="inline-note">Daily reset: 00:00 UTC. No bonus coins or prizes.</p>
    {activity.todayPredictions === 0 && <a className="button button-secondary button-small" href="#markets">Explore markets</a>}
  </section>;
}
