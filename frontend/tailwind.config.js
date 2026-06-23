export default {
  content: ['./index.html','./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tw: {
          bg: '#0e0e10',
          surface: '#18181b',
          surface2: '#1f1f23',
          surface3: '#26262c',
          border: '#2a2a35',
          purple: '#9147ff',
          'purple-dark': '#6b34c7',
          text: '#efeff1',
          muted: '#adadb8',
          red: '#f04747',
          green: '#00b37e',
          yellow: '#faa61a',
          blue: '#5865f2',
        }
      }
    }
  },
  plugins: []
}
