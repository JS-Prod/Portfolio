export type Project = {
  id: string
  title: string
  year: string
  role: string
  summary: string
  demoLabel: string
  demoNote: string
  demoUrl?: string
  contribution: string
  approach: string
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
    demoLabel: 'Live In Scene',
    demoNote:
      'This node is a live demo. Orbit and zoom to inspect the full simulation loop, ribbon motion, and cinematic transition behavior in real time.',
    contribution:
      'Owned the end-to-end visual engineering work: GPU simulation architecture, shader authoring, scene direction, and interactive performance tuning.',
    approach:
      'Implemented a GPU-first pipeline with ping-pong simulation textures and custom GLSL passes, then layered deterministic timing so each visual phase remains art-directable.',
    impact:
      'Cycles through a collection of 3D models, repeating a full mesh-to-particle-to-dissolve sequence in real time.',
    theme: 'Generative simulation',
    stack: ['React Three Fiber', 'Three.js', 'GPGPU', 'GLSL', 'TypeScript'],
    coordinates: [-2.6, 1.1, -1.8],
    color: '#addfff',
  },
  {
    id: 'voyce',
    title: 'Voyce',
    year: '2025',
    role: 'Full-Stack Engineer',
    summary:
      'A receptionist voice-agent platform at wirmi.net/voyce with a Next.js frontend and a hybrid backend architecture.',
    demoLabel: 'Open Voyce',
    demoNote:
      'Production workflow demo with real-time call handling, transcript flow, and backend orchestration for voice-first customer interactions.',
    demoUrl: 'https://wirmi.net/voyce',
    contribution:
      'Built core frontend and backend layers for live voice sessions, including call lifecycle handling, transcript processing, and operational reliability controls.',
    approach:
      'Used a hybrid model: stateless API orchestration for workflow tasks plus persistent WebSocket services for low-latency audio transport and state handoff.',
    impact:
      'Uses Next.js API routes for stateless workflows and a Node.js service for WebSocket handling and audio transcoding across the real-time pipeline.',
    theme: 'Voice infrastructure',
    stack: ['Next.js', 'Node.js', 'WebSockets', 'Twilio', 'Vertex AI (STT/TTS/LLM)'],
    coordinates: [0.45, -0.7, 1.6],
    color: '#b7f1e1',
  },
  {
    id: 'tone-tap',
    title: 'Tone Tap',
    year: '2024',
    role: 'Mobile + Backend Engineer',
    summary:
      'A music-memory game published on Google Play that challenges players to recall and replay tonal patterns.',
    demoLabel: 'Playable Build',
    demoNote:
      'Published mobile title featuring short-session memory gameplay with escalating challenge and progression feedback loops.',
    contribution:
      'Implemented the React Native gameplay client and the backend progression/scoring services, coordinating both sides of the release.',
    approach:
      'Split responsibilities between local, low-latency interaction loops and server-backed rules for progression integrity and score consistency.',
    impact:
      'Built with a React Native client and a Node + Express backend to support game state, progression, and score flow.',
    theme: 'Interactive audio gameplay',
    stack: ['React Native', 'Node.js', 'Express', 'Google Play'],
    coordinates: [2.7, 0.9, -0.5],
    color: '#ffd8b5',
  },
]
