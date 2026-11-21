import { PageTitle } from "../Dashboard";
import { Card } from "../components/ui";
import { GuidedTimer } from "../components/Timer";
import { useApp } from "../store";
import { ReminderList } from "./Reminders";

export default function EyeCare() {
  const { snap, toast } = useApp();
  if (!snap) return null;
  return (
    <>
      <PageTitle title="Eye Care" subtitle="Regular screen breaks. Not a substitute for an eye test; see an optician if you have symptoms." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="20-20-20 break">
          <p className="text-sm text-fg-muted">A popular habit: every 20 minutes, look at something about 20 feet (6 metres) away for 20 seconds.</p>
          <div className="mt-3">
            <GuidedTimer seconds={20} label="20 second eye break" onDone={() => toast("Eye break finished")} />
          </div>
        </Card>
        <Card title="Other quick ideas">
          <ul className="space-y-2 text-sm text-fg-muted">
            <li>
              <b className="text-fg">Blink break.</b> Blink slowly ten times. <GuidedTimer seconds={15} label="blink break" />
            </li>
            <li>
              <b className="text-fg">Palming.</b> Rub your hands warm, cup them over closed eyes and breathe. <GuidedTimer seconds={30} label="palming" />
            </li>
            <li>
              <b className="text-fg">Screen check.</b> Keep the screen about an arm's length away with the top near eye level, and reduce glare.
            </li>
          </ul>
        </Card>
        <Card title="Eye reminders" className="lg:col-span-2">
          <ReminderList filter={(r) => r.category === "eyes"} />
        </Card>
      </div>
    </>
  );
}
