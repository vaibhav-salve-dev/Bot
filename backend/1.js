const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanjivani_chatbot';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('⚠️ MongoDB not connected'));

// ============= Conversation Schema =============
const messageSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    messages: [messageSchema],
    metadata: {
        totalQueries: { type: Number, default: 0 },
        lastActivity: { type: Date, default: Date.now }
    },
    lastActive: { type: Date, default: Date.now }
});

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

const sessions = new Map();

function getHistory(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, []);
    }
    return sessions.get(sessionId);
}

function saveToHistory(sessionId, userMsg, botMsg) {
    const history = getHistory(sessionId);
    history.push({ user: userMsg, bot: botMsg, timestamp: Date.now() });
    if (history.length > 30) history.shift();
}

// ============= COMPLETE COLLEGE DATA =============
const COLLEGE_DATA = `
Sanjivani College of Engineering, Kopargaon (An Autonomous Institute)
Established: 1983
Location: Kopargaon, Ahmednagar District, Maharashtra
PIN Code: 423603
Accreditation: NAAC 'A' Grade, NBA Accredited (Tier-1), AICTE Approved, ISO 9001:2015 Certified
Status: Autonomous Institute affiliated to Savitribai Phule Pune University (SPPU)
Campus: 50+ acres, 1 km from Kopargaon Railway Station

B.TECH BRANCHES:
1. Computer Science & Engineering (CSE): 120 seats, 95% placement, avg ₹7.5 LPA, highest ₹27 LPA. Cutoffs: General 92, OBC 85, SC 75, ST 70. HOD: Dr. S. S. Apte.
2. Mechanical Engineering: 120 seats, 82% placement, avg ₹4.8 LPA, highest ₹12 LPA. Cutoffs: General 75, OBC 68, SC 58, ST 53. HOD: Dr. R. K. Patil.
3. Civil Engineering: 60 seats, 75% placement, avg ₹4.2 LPA, highest ₹9 LPA. Cutoffs: General 70, OBC 63, SC 53, ST 48. HOD: Dr. A. B. Kulkarni.
4. Electrical Engineering: 60 seats, 78% placement, avg ₹4.5 LPA, highest ₹10 LPA. Cutoffs: General 72, OBC 65, SC 55, ST 50. HOD: Dr. V. N. Bapat.
5. Electronics & Telecommunication (E&TC): 60 seats, 80% placement, avg ₹4.6 LPA, highest ₹11 LPA. Cutoffs: General 74, OBC 67, SC 57, ST 52. HOD: Dr. M. S. Kasar.
6. Information Technology (IT): 60 seats, 85% placement, avg ₹6.0 LPA, highest ₹18 LPA. Cutoffs: General 80, OBC 73, SC 63, ST 58. HOD: Dr. P. R. Deshmukh.

PLACEMENT: 85% rate, Highest ₹27 LPA, Average ₹5.8 LPA, 827 students placed. Top Recruiters: TCS (190), Infosys (145), Wipro (120), Microsoft (3), Amazon (8).

FEES: B.Tech ₹1,21,000/year. Hostel: Single ₹95,000, Double ₹75,000, Triple ₹65,000. Transport ₹25,000. Mess ₹35,000.

SCHOLARSHIPS: SC full waiver, ST full + hostel, OBC 50% (income < ₹6L), Merit 100% for 90%+.

HOSTEL: Boys 800, Girls 500. Amenities: Wi-Fi, gym, security, CCTV.

CONTACT: +91-2421-223800, admission@sanjivanicoe.org.in

DATES: Application starts March 1, Last June 15, Exam May 20, Counseling July 1-25, Classes August 1.
`;

// ============= OLLAMA API CALL =============
async function callOllama(prompt) {
    try {
        const response = await axios.post(
            'http://localhost:11434/api/generate',
            {
                model: 'phi3',
                prompt: prompt,
                stream: false,
                temperature: 0.3,
                max_tokens: 150,
                top_p: 0.9
            },
            {
                timeout: 120000
            }
        );
        
        if (response.data && response.data.response) {
            return response.data.response;
        }
        return null;
    } catch (error) {
        console.log('Ollama error:', error.message);
        return null;
    }
}

// ============= GENERATE AI RESPONSE =============
async function generateAIResponse(message, history) {
    let conversationHistory = '';
    for (const msg of history.slice(-5)) {
        conversationHistory += `User: ${msg.user}\nAssistant: ${msg.bot}\n`;
    }
    
    const prompt = `You are an AI assistant for Sanjivani College of Engineering. Answer questions based on the college information provided.

COLLEGE INFORMATION:
${COLLEGE_DATA}

CONVERSATION HISTORY:
${conversationHistory}

User: ${message}
Assistant:`;

    try {
        const response = await callOllama(prompt);
        if (response) {
            return response.trim();
        }
        return null;
    } catch (error) {
        console.error('AI error:', error.message);
        return null;
    }
}

// ============= FALLBACK =============
function getFallback(message) {
    const lower = message.toLowerCase();
    if (lower.match(/^(hi|hello|hey|hii)$/)) {
        return "👋 Hello! I'm your Sanjivani College AI Assistant. Ask me about branches, cutoffs, placements, fees, hostels, or scholarships!";
    }
    return "I can help with Sanjivani College. What would you like to know?";
}

// ============= GENERATE UI =============
function generateUIContext(message) {
    const lower = message.toLowerCase();
    let uiContext = { type: 'text', data: null };
    
    if (lower.includes('placement') || lower.includes('package')) {
        uiContext.type = 'placement';
        uiContext.data = {
            heading: '📊 Placement Statistics',
            metrics: [
                { label: 'Highest Package', value: '₹27 LPA', icon: '🏆' },
                { label: 'Average Package', value: '₹5.8 LPA', icon: '📈' },
                { label: 'Placement Rate', value: '85%', icon: '🎯' }
            ]
        };
    }
    
    if (lower.includes('cutoff')) {
        uiContext.type = 'cutoff';
        uiContext.data = {
            heading: '📋 MHT-CET Cutoffs',
            branches: [
                { name: 'CSE', general: 92, sc: 75, obc: 85, st: 70 },
                { name: 'Mechanical', general: 75, sc: 58, obc: 68, st: 53 }
            ]
        };
    }
    
    if (lower.includes('fee') || lower.includes('fees') || lower.includes('cost')) {
        uiContext.type = 'fees';
        uiContext.data = {
            heading: '💰 Fee Structure',
            items: [
                { label: 'B.Tech Tuition', value: '₹1,21,000/year' },
                { label: 'Hostel (Single)', value: '₹95,000/year' },
                { label: 'Hostel (Double)', value: '₹75,000/year' },
                { label: 'Hostel (Triple)', value: '₹65,000/year' }
            ]
        };
    }
    
    return uiContext;
}

// ============= API =============

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    const session = sessionId || `session_${Date.now()}`;
    
    console.log(`\n📩 User: "${message}"`);
    
    if (!message || message.trim().length === 0) {
        return res.json({ reply: "Please enter a question. I'm here to help!" });
    }
    
    const history = getHistory(session);
    let reply = null;
    let usedAI = false;
    
    try {
        const aiResponse = await generateAIResponse(message, history);
        if (aiResponse && aiResponse.length > 5) {
            reply = aiResponse;
            usedAI = true;
        }
    } catch (error) {
        console.log('AI failed, using fallback');
    }
    
    if (!reply) {
        reply = getFallback(message);
        usedAI = false;
    }
    
    saveToHistory(session, message, reply);
    
    try {
        let conversation = await Conversation.findOne({ sessionId: session });
        if (!conversation) {
            conversation = new Conversation({ sessionId: session, messages: [] });
        }
        conversation.messages.push(
            { role: 'user', content: message, timestamp: new Date() },
            { role: 'assistant', content: reply, timestamp: new Date() }
        );
        conversation.metadata.totalQueries += 1;
        conversation.lastActive = new Date();
        if (conversation.messages.length > 30) {
            conversation.messages = conversation.messages.slice(-30);
        }
        await conversation.save();
    } catch (err) {}
    
    const uiContext = generateUIContext(message);
    
    res.json({
        reply: reply,
        sessionId: session,
        uiContext: uiContext,
        aiModel: usedAI ? 'Mistral (Ollama)' : 'Smart Fallback'
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        college: 'Sanjivani College of Engineering',
        aiModel: 'Mistral (Ollama)',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║     🧠 SANJIVANI AI CHATBOT - OLLAMA POWERED!           ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🧠 AI Model: Mistral (Ollama - Local)`);
    console.log(`💾 Database: ${mongoose.connection.readyState === 1 ? 'MongoDB Connected' : 'Memory Mode'}`);
    console.log(`\n✅ REAL AI FEATURES:`);
    console.log(`   ✅ Real LLM (Mistral)`);
    console.log(`   ✅ No API Keys Required`);
    console.log(`   ✅ 100% Free & Offline`);
    console.log(`   ✅ Context Understanding`);
    console.log(`\n🚀 Make sure Ollama is running and model is downloaded:`);
    console.log(`   ollama pull mistral`);
    console.log(`   Then run: node server.js\n`);
});