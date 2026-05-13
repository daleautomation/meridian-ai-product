import { platformModules } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function PlatformSection() {
  return (
    <section id="platform" className="public-section">
      <SectionIntro
        eyebrow="Platform"
        title="A unified intelligence layer for cleaner execution."
        text="Meridian organizes the signals, decisions, and next actions that operators need without adding another noisy dashboard."
      />
      <div className="public-module-grid">
        {platformModules.map((module) => (
          <div key={module.title}>
            <span />
            <strong>{module.title}</strong>
            <p>{module.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
