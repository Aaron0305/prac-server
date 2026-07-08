export default function Home() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900 text-white">
            <div className="text-center max-w-2xl px-6">
                <div className="mb-8">
                    <div className="w-20 h-20 mx-auto bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center mb-6">
                        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                        </svg>
                    </div>
                    <h1 className="text-4xl font-bold mb-2">🎓 English Learning Academy</h1>
                    <p className="text-xl text-gray-400">Backend API Server</p>
                </div>

                <div className="bg-gray-800/50 backdrop-blur rounded-2xl p-6 mb-8 border border-gray-700">
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                        <span className="text-green-400 font-medium">Server Running</span>
                    </div>
                    <p className="text-gray-400">
                        API disponible en <code className="bg-gray-700 px-2 py-1 rounded text-cyan-400">/api</code>
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                    <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/50">
                        <h3 className="font-semibold text-blue-400 mb-2">📡 Endpoints</h3>
                        <ul className="text-sm text-gray-400 space-y-1">
                            <li>/api/auth/login</li>
                            <li>/api/students</li>
                            <li>/api/admins</li>
                            <li>/api/payments</li>
                        </ul>
                    </div>
                    <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/50">
                        <h3 className="font-semibold text-purple-400 mb-2">⚙️ Config</h3>
                        <ul className="text-sm text-gray-400 space-y-1">
                            <li>Puerto: 3001</li>
                            <li>DB: Supabase</li>
                            <li>Auth: JWT</li>
                            <li>Framework: Next.js</li>
                        </ul>
                    </div>
                </div>

                <p className="mt-8 text-gray-500 text-sm">
                    Ver <code className="bg-gray-700 px-2 py-0.5 rounded">SETUP_GUIDE.md</code> para configuración completa
                </p>
            </div>
        </div>
    );
}
