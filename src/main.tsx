import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/studio.css'
import './styles/dialogs.css'
import './styles/workspace.css'
import './styles/world.css'
import './styles/visual.css'
import './styles/assistant.css'

createRoot(document.getElementById('root')!).render(<App />)
