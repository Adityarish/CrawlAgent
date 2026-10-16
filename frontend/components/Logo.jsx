import { Asterisk } from "lucide-react";

export function Logo({ compact = false }) {
  return (
    <div className="brand" aria-label="JobAtlas home">
      <span className="brand-mark"><Asterisk size={20} strokeWidth={2.4} /></span>
      {!compact && <span>JobAtlas</span>}
    </div>
  );
}
