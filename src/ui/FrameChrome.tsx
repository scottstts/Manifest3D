export function FrameChrome() {
  return (
    <header className="frame-chrome" aria-label="Manifest3D frame">
      <div className="brand-lockup" aria-label="Manifest3D" role="img">
        <img
          alt=""
          aria-hidden="true"
          className="brand-logo-img"
          src="/logo.png"
        />
        <svg
          aria-hidden="true"
          className="brand-wordmark"
          viewBox="0 0 390 90"
        >
          <defs>
            <linearGradient id="manifestWordmarkGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#f0d7ff" />
              <stop offset="38%" stopColor="#c67aff" />
              <stop offset="100%" stopColor="#8424e8" />
            </linearGradient>
            <filter
              height="142%"
              id="manifestWordmarkGlass"
              width="142%"
              x="-21%"
              y="-21%"
            >
              <feGaussianBlur
                in="SourceAlpha"
                result="smoothAlpha"
                stdDeviation="3.5"
              />
              <feSpecularLighting
                in="smoothAlpha"
                lightingColor="#ffffff"
                result="specLight"
                specularConstant="1.15"
                specularExponent="45"
                surfaceScale="4"
              >
                <feDistantLight azimuth="-45" elevation="55" />
              </feSpecularLighting>
              <feComposite
                in="specLight"
                in2="SourceAlpha"
                operator="in"
                result="specLightMasked"
              />
              <feGaussianBlur
                in="SourceAlpha"
                result="shadowBlur"
                stdDeviation="2"
              />
              <feOffset dx="-1" dy="4" in="shadowBlur" result="shadowOffset" />
              <feComposite
                in="SourceAlpha"
                in2="shadowOffset"
                operator="out"
                result="shadowMask"
              />
              <feFlood
                floodColor="#410082"
                floodOpacity="0.74"
                result="shadowColor"
              />
              <feComposite
                in="shadowColor"
                in2="shadowMask"
                operator="in"
                result="innerShadow"
              />
              <feOffset dx="1" dy="-2" in="shadowBlur" result="rimOffset" />
              <feComposite
                in="SourceAlpha"
                in2="rimOffset"
                operator="out"
                result="rimMask"
              />
              <feFlood
                floodColor="#ffffff"
                floodOpacity="0.62"
                result="rimColor"
              />
              <feComposite
                in="rimColor"
                in2="rimMask"
                operator="in"
                result="innerRim"
              />
              <feMerge result="merged">
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="innerShadow" />
                <feMergeNode in="innerRim" />
                <feMergeNode in="specLightMasked" />
              </feMerge>
              <feDropShadow
                dx="0"
                dy="8"
                floodColor="#6924c6"
                floodOpacity="0.24"
                in="merged"
                stdDeviation="6"
              />
            </filter>
          </defs>
          <text
            dominantBaseline="middle"
            fill="url(#manifestWordmarkGrad)"
            filter="url(#manifestWordmarkGlass)"
            fontFamily="Arial Rounded MT Bold, Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif"
            fontSize="62"
            fontWeight="800"
            letterSpacing="0"
            stroke="#6416b5"
            strokeOpacity="0.78"
            strokeWidth="2"
            x="0"
            y="55%"
          >
            Manifest3D
          </text>
        </svg>
      </div>
    </header>
  )
}
