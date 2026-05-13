import { services } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function ServicesSection() {
  return (
    <section id="services" className="public-section">
      <SectionIntro
        eyebrow="Services"
        title="Modular services that become one operating system."
        text="Start with a focused business problem, then connect the findings into a workspace your team can run every day."
      />
      <div className="public-service-grid">
        {services.map((service, index) => (
          <article className="public-card" key={service.title}>
            <span className="public-card-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3>{service.title}</h3>
            <p>{service.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
