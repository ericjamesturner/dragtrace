import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LoaderCircleIcon, SparklesIcon, TrashIcon } from "lucide-react";
import { quantitiesWithChoices, type UnitSystem, type UnitOverrides } from "@/lib/units";
import { getDisplayUnit } from "@/lib/units";

/**
 * Describe a channel in words, let Claude write the expression, then check it
 * before saving. The expression stays editable — the generated one is a
 * starting point, not something to take on faith.
 */
export function MathChannelDialog({
  open,
  onOpenChange,
  vehicleId,
  channelNames,
  unitSystem,
  unitOverrides,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: Id<"vehicles">;
  channelNames: string[];
  unitSystem: UnitSystem;
  unitOverrides?: UnitOverrides;
  editing?: Doc<"mathChannels"> | null;
}) {
  const generate = useAction(api.mathChannels.generate);
  const createChannel = useMutation(api.mathChannels.create);
  const updateChannel = useMutation(api.mathChannels.update);
  const removeChannel = useMutation(api.mathChannels.remove);

  const [prompt, setPrompt] = useState(editing?.prompt ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [expression, setExpression] = useState(editing?.expression ?? "");
  const [quantitySlug, setQuantitySlug] = useState(editing?.quantitySlug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPrompt("");
    setName("");
    setExpression("");
    setQuantitySlug("");
    setError(null);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const unitPrefs = quantitiesWithChoices()
        .map((q) => `  ${q.name} shown in ${getDisplayUnit(q.slug, unitSystem, unitOverrides)}`)
        .join("\n");
      const result = await generate({
        description: prompt.trim(),
        channelNames,
        unitPrefs,
      });
      setName(result.name);
      setExpression(result.expression);
      setQuantitySlug(result.quantitySlug ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate an expression");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !expression.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await updateChannel({
          id: editing._id,
          name: name.trim(),
          expression: expression.trim(),
          quantitySlug: quantitySlug || undefined,
        });
      } else {
        await createChannel({
          vehicleId,
          name: name.trim(),
          expression: expression.trim(),
          quantitySlug: quantitySlug || undefined,
          prompt: prompt.trim() || undefined,
        });
      }
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit math channel" : "New math channel"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              What should it work out?
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Driveshaft slip as a percentage of engine speed"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleGenerate();
              }}
            />
            <Button size="sm" variant="outline" onClick={() => void handleGenerate()} disabled={busy || !prompt.trim()}>
              {busy ? (
                <LoaderCircleIcon className="size-4 mr-1 animate-spin" />
              ) : (
                <SparklesIcon className="size-4 mr-1" />
              )}
              {expression ? "Regenerate" : "Generate"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Driveshaft Slip %" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              Expression — channels in {"{braces}"}, edit freely
            </label>
            <Textarea
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="{RPM} > 0 ? (1 - {Driveshaft RPM} / {RPM}) * 100 : 0"
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Units</label>
            <select
              value={quantitySlug}
              onChange={(e) => setQuantitySlug(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Unitless (ratios, counts)</option>
              {quantitiesWithChoices().map((q) => (
                <option key={q.slug} value={q.slug}>{q.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void handleSave()} disabled={busy || !name.trim() || !expression.trim()}>
              {editing ? "Save" : "Create"}
            </Button>
            <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
              Cancel
            </Button>
            {editing && (
              <Button
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={async () => {
                  await removeChannel({ id: editing._id });
                  reset();
                  onOpenChange(false);
                }}
              >
                <TrashIcon className="size-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
