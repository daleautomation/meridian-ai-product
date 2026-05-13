import { beforeAfterStory } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function BeforeAfterSection() {
  return (
    <section id="transformation" className="public-section public-before-after-section">
      <SectionIntro
        eyebrow={beforeAfterStory.eyebrow}
        title={beforeAfterStory.title}
        text={beforeAfterStory.text}
      />
      <div className="public-before-after-grid">
        <article className="public-transformation-column public-transformation-before">
          <div className="public-transformation-header">
            <span>Before Meridian</span>
            <strong>Reactive execution</strong>
          </div>
          <div className="public-transformation-list">
            {beforeAfterStory.before.map((item) => (
              <div key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>

        <div className="public-transformation-shift" aria-hidden="true">
          <span>Becomes</span>
        </div>

        <article className="public-transformation-column public-transformation-after">
          <div className="public-transformation-header">
            <span>After Meridian</span>
            <strong>Calm operator control</strong>
          </div>
          <div className="public-transformation-list">
            {beforeAfterStory.after.map((item) => (
              <div key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
