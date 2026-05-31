import type { ReactNode } from "react";

type BriefSectionContentProps = {
  content: string;
};

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function BriefSectionContent({ content }: BriefSectionContentProps) {
  if (!content.trim()) {
    return <p className="heartbeat-section-empty">No details recorded.</p>;
  }

  const blocks = content.split(/\n{2,}/);

  return (
    <div className="heartbeat-section-body">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((line) => line.startsWith("- "));

        if (isList) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.slice(2))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={blockIndex}>{renderInline(lines.join(" "))}</p>
        );
      })}
    </div>
  );
}
