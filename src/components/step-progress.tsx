import { getDict } from "@/i18n";
import { cn } from "@/lib/utils";

// Sihirbazın üstündeki 5 adımlı ilerleme çubuğu. current: 1-5.
export function StepProgress({ current }: { current: number }) {
  const t = getDict();
  const names = t.steps.names;
  return (
    <nav aria-label={t.steps.label}>
      <p className="mb-2 text-base font-medium">
        {t.steps.position(current, names.length)}: {names[current - 1]}
      </p>
      <ol className="grid grid-cols-5 gap-1.5">
        {names.map((name, i) => {
          const step = i + 1;
          return (
            <li key={name} aria-current={step === current ? "step" : undefined}>
              <div
                className={cn("h-1.5 rounded-full", step <= current ? "bg-primary" : "bg-muted")}
              />
              <span
                className={cn(
                  "mt-1.5 hidden text-[15px] sm:block",
                  step === current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {name}
              </span>
              <span className="sr-only sm:hidden">{name}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
