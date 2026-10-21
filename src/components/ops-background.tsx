export function OpsBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[#070b14]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,_rgba(31,101,152,0.38),_transparent_52%),radial-gradient(ellipse_at_90%_15%,_rgba(115,149,184,0.22),_transparent_48%),radial-gradient(ellipse_at_50%_100%,_rgba(31,101,152,0.28),_transparent_55%),linear-gradient(160deg,_#070b14_0%,_#0a1220_50%,_#070b14_100%)]" />

      <div className="beam absolute -top-[20%] left-[15%] h-[120%] w-[38%] bg-[linear-gradient(90deg,_transparent,_rgba(115,149,184,0.14),_transparent)] blur-2xl" />

      <div className="orb-a absolute -top-[10%] -left-[5%] h-[48vmin] w-[48vmin] rounded-full bg-[radial-gradient(circle,_rgba(31,101,152,0.5)_0%,_transparent_68%)] blur-3xl" />
      <div className="orb-b absolute top-[20%] -right-[12%] h-[56vmin] w-[56vmin] rounded-full bg-[radial-gradient(circle,_rgba(115,149,184,0.32)_0%,_transparent_70%)] blur-3xl" />
      <div className="orb-c absolute -bottom-[20%] left-[35%] h-[50vmin] w-[50vmin] rounded-full bg-[radial-gradient(circle,_rgba(31,101,152,0.36)_0%,_transparent_72%)] blur-3xl" />

      <div
        className="absolute inset-0 opacity-[0.28]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
          backgroundRepeat: "repeat",
          backgroundSize: "180px 180px",
          mixBlendMode: "soft-light",
        }}
      />

      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,_transparent_0%,_rgba(7,11,20,0.45)_100%)]" />
    </div>
  );
}
