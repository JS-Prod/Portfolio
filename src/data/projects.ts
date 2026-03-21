export type Project = {
  id: string
  title: string
  year: string
  role: string
  summary: string
  impact: string
  theme: string
  stack: string[]
  coordinates: [number, number, number]
  color: string
}

export const projects: Project[] = [
  {
    id: 'gpgpu-particles',
    title: 'GPGPU Particles',
    year: '2025',
    role: 'Creative Developer',
    summary:
      'A React Three Fiber experiment running a one-million-particle GPU simulation on a black stage. Colored particles orbit a 3D mesh, then blast toward the camera until they vanish.',
    impact:
      'Cycles through a collection of 3D models, repeating a full mesh-to-particle-to-dissolve sequence in real time.',
    theme: 'Generative simulation',
    stack: ['React Three Fiber', 'Three.js', 'GPGPU', 'GLSL', 'TypeScript'],
    coordinates: [-2.6, 1.1, -1.8],
    color: '#7ec8ff',
  },
  {
    id: 'voyce',
    title: 'Voyce',
    year: '2025',
    role: 'Full-Stack Engineer',
    summary:
      'A receptionist voice-agent platform at wirmi.net/voyce with a Next.js frontend and a hybrid backend architecture.',
    impact:
      'Uses Next.js API routes for stateless workflows and a Node.js service for WebSocket handling and audio transcoding across the real-time pipeline.',
    theme: 'Voice infrastructure',
    stack: ['Next.js', 'Node.js', 'WebSockets', 'Twilio', 'Vertex AI (STT/TTS/LLM)'],
    coordinates: [0.45, -0.7, 1.6],
    color: '#93f6d8',
  },
  {
    id: 'tone-tap',
    title: 'Tone Tap',
    year: '2024',
    role: 'Mobile + Backend Engineer',
    summary:
      'A music-memory game published on Google Play that challenges players to recall and replay tonal patterns.',
    impact:
      'Built with a React Native client and a Node + Express backend to support game state, progression, and score flow.',
    theme: 'Interactive audio gameplay',
    stack: ['React Native', 'Node.js', 'Express', 'Google Play'],
    coordinates: [2.7, 0.9, -0.5],
    color: '#ffbd85',
  },
]
