export type ViewportWorldMode = 'light' | 'dark'

type ViewportWorldLight = {
  color: string
  intensity: number
  position: [number, number, number]
}

type ViewportWorldEnvironment = {
  backgroundColor: string
  fog: {
    color: string
    density: number
  }
  ground: {
    color: string
    metalness: number
    roughness: number
  }
  lights: {
    fill: ViewportWorldLight
    hemisphere: {
      groundColor: string
      intensity: number
      skyColor: string
    }
    key: ViewportWorldLight
  }
}

const lightWorldEnvironment: ViewportWorldEnvironment = {
  backgroundColor: '#f7f7fb',
  fog: {
    color: '#efeff9',
    density: 0.018,
  },
  ground: {
    color: '#f4f3fb',
    metalness: 0.05,
    roughness: 0.36,
  },
  lights: {
    fill: {
      color: '#cbd5ff',
      intensity: 0.62,
      position: [4.2, 3.2, -4.5],
    },
    hemisphere: {
      groundColor: '#d9dbee',
      intensity: 1.35,
      skyColor: '#ffffff',
    },
    key: {
      color: '#ffffff',
      intensity: 1.9,
      position: [-4.4, 6.5, 3.6],
    },
  },
}

const darkWorldEnvironment: ViewportWorldEnvironment = {
  backgroundColor: '#14151d',
  fog: {
    color: '#1d1e2a',
    density: 0.026,
  },
  ground: {
    color: '#232431',
    metalness: 0.04,
    roughness: 0.5,
  },
  lights: {
    fill: {
      color: '#66709c',
      intensity: 0.1,
      position: [4.2, 3.2, -4.5],
    },
    hemisphere: {
      groundColor: '#242737',
      intensity: 0.18,
      skyColor: '#6f748d',
    },
    key: {
      color: '#bfc8ff',
      intensity: 0.34,
      position: [-4.4, 6.5, 3.6],
    },
  },
}

const viewportWorldEnvironments: Record<
  ViewportWorldMode,
  ViewportWorldEnvironment
> = {
  dark: darkWorldEnvironment,
  light: lightWorldEnvironment,
}

export function getViewportWorldEnvironment(mode: ViewportWorldMode) {
  return viewportWorldEnvironments[mode]
}
