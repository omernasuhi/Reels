import { Alert } from "@/components/ui/alert";
import { getDict } from "@/i18n";

export function SetupNotice() {
  const t = getDict();
  return (
    <Alert>
      <p className="font-medium">{t.setup.title}</p>
      <p className="mt-1">{t.setup.body}</p>
    </Alert>
  );
}
