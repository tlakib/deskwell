import { PageTitle } from "../Dashboard";
import { Card } from "../components/ui";
import { GuidedTimer } from "../components/Timer";
import { useApp } from "../store";
import { ReminderList } from "./Reminders";

/** Simple, low-intensity desk movements. Wording avoids medical claims on purpose. */
export const EXERCISES = [
  { name: "Neck release", seconds: 30, steps: "Sit tall. Slowly tilt your ear toward one shoulder, hold, then switch sides. Move gently and stop if anything hurts." },
  { name: "Shoulder rolls", seconds: 30, steps: "Roll your shoulders slowly backwards ten times, then forwards ten times." },
  { name: "Upper-back stretch", seconds: 30, steps: "Clasp your hands in front of you, round your upper back and push your hands away. Breathe slowly." },
  { name: "Wrist & finger stretch", seconds: 30, steps: "Extend one arm, palm up, and gently pull the fingers back with the other hand. Switch hands." },
  { name: "Seated twist", seconds: 30, steps: "Sit tall, place one hand on the opposite knee and gently turn your upper body. Switch sides." },
  { name: "Calf raises", seconds: 45, steps: "Stand behind your chair, hold the back for balance, rise onto your toes and lower slowly." },
  { name: "Walk break", seconds: 120, steps: "Walk around the room or to get water. Look at something far away while you walk." },
];

export default function Movement() {
  const { snap } = useApp();
  if (!snap) return null;
  return (
    <>
      <PageTitle title="Movement & Exercises" subtitle="Short, gentle routines. Listen to your body and skip anything uncomfortable." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Quick routines">
          <ul className="divide-y divide-line">
            {EXERCISES.map((x) => (
              <li key={x.name} className="flex items-start gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{x.name}</div>
                  <p className="text-xs text-fg-muted">{x.steps}</p>
                </div>
                <GuidedTimer seconds={x.seconds} label={x.name} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Movement reminders">
          <ReminderList filter={(r) => ["stand", "walk", "stretch", "posture", "breathing", "rest"].includes(r.category)} />
        </Card>
      </div>
    </>
  );
}
