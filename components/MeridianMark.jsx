// Meridian AI — unified brand mark.
//
// One shared component used on the public page (nav + hero)
// and inside the internal module shell (sidebar). Always the
// same visual language: rounded square, cyan "M".

export default function MeridianMark({ size = 28, color = "#68ECF4", bg = "#0C0731" }) {
  const r = Math.round(size * 0.25);
  const fs = Math.round(size * 0.46);
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: r,
      background: color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: fs,
      fontWeight: 800,
      color: bg,
      fontFamily: "'Syne', sans-serif",
      flexShrink: 0,
      lineHeight: 1,
    }}>
      M
    </div>
  );
}
