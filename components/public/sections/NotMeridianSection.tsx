import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { notMeridianCards } from "@/content/public/home";

export function NotMeridianSection() {
  return (
    <section className="public-section public-not-section">
      <SectionIntro
        eyebrow="Meridian is not"
        title="Not another place to store work. A system for moving it with confidence."
        text="Meridian sits between strategy and execution: operator intelligence, workflow orchestration, accountability systems, and operational visibility in one custom-built workspace."
      />
      <div className="public-not-grid">
        {notMeridianCards.map((item) => (
          <article className="public-not-card" key={item.title}>
            <span>{item.title}</span>
            <div>
              <strong>Not</strong>
              <p>{item.not}</p>
            </div>
            <div>
              <strong>Meridian is</strong>
              <p>{item.meridian}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
