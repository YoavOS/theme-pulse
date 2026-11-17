import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

const HEBREW = /[֐-׿]/;
const TICKER = /^[A-Z][A-Z0-9.-]{0,6}$/;

/** The AI's markdown, in the app's style. Hebrew text is laid out right-to-left; bold tickers open the Lens. */
export default function AiMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const rtl = HEBREW.test(text.slice(0, 400));
  return (
    <article dir={rtl ? "rtl" : "ltr"} className={`space-y-1.5 text-[13px] leading-relaxed ${rtl ? "font-['Heebo','Segoe_UI',Arial,sans-serif]" : ""} ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h3 className="mt-3 text-[15px] font-semibold text-foreground first:mt-0">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-3 text-[13px] font-semibold text-primary first:mt-0">{children}</h4>,
          h3: ({ children }) => <h4 className="mt-2.5 text-[12.5px] font-semibold text-primary first:mt-0">{children}</h4>,
          ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1">{children}</ol>,
          li: ({ children }) => <li className="flex gap-1.5"><span className="text-primary">•</span><span className="min-w-0 flex-1">{children}</span></li>,
          p: ({ children }) => <p className="text-foreground/90">{children}</p>,
          strong: ({ children }) => {
            const t = String(Array.isArray(children) ? children.join("") : children ?? "").trim();
            return TICKER.test(t)
              ? <Link dir="ltr" to={`/lens?symbol=${t}`} className="font-mono font-semibold text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">{t}</Link>
              : <strong className="font-semibold text-foreground">{children}</strong>;
          },
          code: ({ children }) => <code dir="ltr" className="rounded bg-muted px-1 font-mono text-[12px]">{children}</code>,
          table: ({ children }) => <div className="overflow-x-auto"><table className="w-full text-[12px]">{children}</table></div>,
          th: ({ children }) => <th className="border-b border-border px-2 py-1 text-start font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/50 px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}
