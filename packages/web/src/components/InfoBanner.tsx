import { CheckCircle2 } from "lucide-react";

export function InfoBanner({ message }: { message: string }) {
  return (
    <div className="info-banner">
      <CheckCircle2 size={16} />
      {message}
    </div>
  );
}
