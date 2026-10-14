import { Dialog } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { SHORTCUTS } from "./shortcuts";

const STEPS = [
  { title: "Design the face here", body: "Start from a template or an empty face. Add time, date, hands, data and rings, and check them against the simulated watch." },
  { title: "Export the .hwt", body: "Press Export .hwt, read the checklist, then download. The file name keeps letters and digits only, as Huawei requires." },
  { title: "Move it to your phone", body: "Send the file to the phone that runs JoyoFit: cloud drive, cable or any messenger." },
  { title: "Install from JoyoFit", body: "Open JoyoFit, go to Settings or Watch, then Watch faces, then Install from file, and pick the .hwt. The upload takes a minute." },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Make a face for your Watch Fit 4"
      description="JoyoFit Studio draws the face in your browser and writes a Huawei .hwt file. Nothing is uploaded."
      className="max-w-2xl"
      testId="help-dialog"
      footer={
        <Button onClick={onClose} data-testid="help-start">
          Start designing
        </Button>
      }
    >
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary tabular-nums">{i + 1}</span>
            <div>
              <p className="text-sm font-bold">{s.title}</p>
              <p className="text-[0.8125rem] text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl bg-warning-soft p-4 text-[0.8125rem] leading-relaxed">
        <p className="font-bold">Unofficial and early</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>These faces are not made, signed or endorsed by Huawei. Whether the Fit 4 accepts an unsigned face is not known yet.</li>
          <li>Only the Watch Fit 4 and Fit 4 Pro (408 × 480) are supported for now.</li>
          <li>
            Some elements are marked <span className="font-semibold">Preview only</span> or <span className="font-semibold">Unconfirmed on a watch</span>. Preview only
            elements are never exported. Unconfirmed ones use ids read from sample faces and are written only if you leave that switch on in the export dialog.
          </li>
          <li>Back up the face you use today: the watch can be set back to a built-in face from the Watch faces screen in JoyoFit.</li>
        </ul>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-bold">Keyboard</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="contents">
            <dt className="font-mono text-xs font-semibold text-foreground/80">{s.keys}</dt>
            <dd className="text-muted-foreground">{s.action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
