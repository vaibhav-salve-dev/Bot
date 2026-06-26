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
    .then(() => console.log(' MongoDB Connected'))
    .catch(err => console.log(' MongoDB not connected'));

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
const responseCache = new Map();

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

// ============= RAG: KNOWLEDGE BASE =============
const KNOWLEDGE_BASE = {
    college: {
        name: "Sanjivani College of Engineering, Kopargaon",
        established: 1983,
        location: "Kopargaon, Ahmednagar District, Maharashtra",
        pinCode: "423603",
        accreditation: "NAAC 'A' Grade, NBA Accredited (Tier-1), AICTE Approved",
        status: "Autonomous Institute affiliated to SPPU",
        campus: "50+ acres, 1 km from Kopargaon Railway Station",
        contact: "+91-2421-223800",
        email: "admission@sanjivanicoe.org.in"
    },
    branches: [
        {
            name: "Computer Science & Engineering",
            short: "CSE",
            seats: 120,
            placement: "95%",
            avgPackage: "₹7.5 LPA",
            highestPackage: "₹27 LPA",
            cutoffs: { general: 92, obc: 85, sc: 75, st: 70 },
            hod: "Dr. S. S. Apte"
        },
        {
            name: "Mechanical Engineering",
            short: "Mechanical",
            seats: 120,
            placement: "82%",
            avgPackage: "₹4.8 LPA",
            highestPackage: "₹12 LPA",
            cutoffs: { general: 75, obc: 68, sc: 58, st: 53 },
            hod: "Dr. R. K. Patil"
        },
        {
            name: "Civil Engineering",
            short: "Civil",
            seats: 60,
            placement: "75%",
            avgPackage: "₹4.2 LPA",
            highestPackage: "₹9 LPA",
            cutoffs: { general: 70, obc: 63, sc: 53, st: 48 },
            hod: "Dr. A. B. Kulkarni"
        },
        {
            name: "Electrical Engineering",
            short: "Electrical",
            seats: 60,
            placement: "78%",
            avgPackage: "₹4.5 LPA",
            highestPackage: "₹10 LPA",
            cutoffs: { general: 72, obc: 65, sc: 55, st: 50 },
            hod: "Dr. V. N. Bapat"
        },
        {
            name: "Electronics & Telecommunication",
            short: "E&TC",
            seats: 60,
            placement: "80%",
            avgPackage: "₹4.6 LPA",
            highestPackage: "₹11 LPA",
            cutoffs: { general: 74, obc: 67, sc: 57, st: 52 },
            hod: "Dr. M. S. Kasar"
        },
        {
            name: "Information Technology",
            short: "IT",
            seats: 60,
            placement: "85%",
            avgPackage: "₹6.0 LPA",
            highestPackage: "₹18 LPA",
            cutoffs: { general: 80, obc: 73, sc: 63, st: 58 },
            hod: "Dr. P. R. Deshmukh"
        }
    ],
    placement: {
        overall: "85%",
        highest: "₹27 LPA",
        average: "₹5.8 LPA",
        studentsPlaced: 827,
        totalOffers: 1050,
        recruiters: ["TCS (190)", "Infosys (145)", "Wipro (120)", "Microsoft (3)", "Amazon (8)"]
    },
    fees: {
        btech: "₹1,21,000 per year",
        hostel: { single: "₹95,000", double: "₹75,000", triple: "₹65,000" },
        transport: "₹25,000",
        mess: "₹35,000"
    },
    scholarships: {
        sc: "Full tuition fee waiver",
        st: "Full tuition fee waiver + hostel reimbursement",
        obc: "50% tuition fee waiver (income < ₹6L)",
        merit: "100% for 90%+, 75% for 80-89%, 50% for 70-79%"
    },
    hostel: {
        boys: "800 capacity",
        girls: "500 capacity",
        amenities: ["Wi-Fi", "Gym", "Security", "CCTV"]
    },
    dates: {
        applicationStart: "March 1, 2026",
        applicationEnd: "June 15, 2026",
        exam: "May 20, 2026",
        counselingStart: "July 1, 2026",
        counselingEnd: "July 25, 2026",
        classesStart: "August 1, 2026"
    }
};

// ============= RAG: RETRIEVAL FUNCTION =============
function retrieveRelevantInfo(query) {
    const lower = query.toLowerCase();
    let relevantText = "";
    let context = {
        branch: null,
        category: null,
        score: null,
        topic: null
    };

    // --- 1. Detect Branch ---
    const branchMap = {
        'cse': 'Computer Science & Engineering',
        'computer': 'Computer Science & Engineering',
        'mechanical': 'Mechanical Engineering',
        'civil': 'Civil Engineering',
        'electrical': 'Electrical Engineering',
        'electronics': 'Electronics & Telecommunication',
        'ece': 'Electronics & Telecommunication',
        'it': 'Information Technology'
    };
    
    for (const [key, value] of Object.entries(branchMap)) {
        if (lower.includes(key)) {
            context.branch = value;
            break;
        }
    }

    // --- 2. Detect Category ---
    if (lower.includes('sc') || lower.includes('schedule caste')) context.category = 'sc';
    else if (lower.includes('st') || lower.includes('schedule tribe')) context.category = 'st';
    else if (lower.includes('obc')) context.category = 'obc';
    else if (lower.includes('general') || lower.includes('open')) context.category = 'general';

    // --- 3. Detect Score ---
    const scoreMatch = query.match(/\d+/);
    if (scoreMatch) context.score = parseInt(scoreMatch[0]);

    // --- 4. Detect Topic ---
    if (lower.includes('cutoff') || lower.includes('cut off')) context.topic = 'cutoff';
    else if (lower.includes('placement') || lower.includes('package') || lower.includes('salary')) context.topic = 'placement';
    else if (lower.includes('fee') || lower.includes('fees') || lower.includes('cost') || lower.includes('tuition')) context.topic = 'fee';
    else if (lower.includes('scholarship') || lower.includes('financial')) context.topic = 'scholarship';
    else if (lower.includes('hostel') || lower.includes('accommodation')) context.topic = 'hostel';
    else if (lower.includes('branch') || lower.includes('course') || lower.includes('program')) context.topic = 'branch';
    else if (lower.includes('contact') || lower.includes('phone') || lower.includes('email')) context.topic = 'contact';
    else if (lower.includes('date') || lower.includes('deadline') || lower.includes('apply')) context.topic = 'dates';
    else if (lower.includes('about') || lower.includes('college')) context.topic = 'about';

    // --- 5. Build Relevant Text Based on Context ---
    if (context.topic === 'cutoff' && context.branch) {
        const branch = KNOWLEDGE_BASE.branches.find(b => b.name === context.branch);
        if (branch) {
            relevantText += `Branch: ${branch.name}\n`;
            relevantText += `Cutoffs: General ${branch.cutoffs.general}, OBC ${branch.cutoffs.obc}, SC ${branch.cutoffs.sc}, ST ${branch.cutoffs.st}\n`;
            if (context.category && branch.cutoffs[context.category]) {
                relevantText += `Your category ${context.category.toUpperCase()} cutoff: ${branch.cutoffs[context.category]}\n`;
                if (context.score) {
                    const cutoff = branch.cutoffs[context.category];
                    relevantText += `Your score: ${context.score}\n`;
                    relevantText += context.score >= cutoff ? " You have a HIGH chance!" : " You have a moderate chance.";
                }
            }
        }
    }
    else if (context.topic === 'cutoff') {
        relevantText += "Branch Cutoffs:\n";
        for (const branch of KNOWLEDGE_BASE.branches) {
            relevantText += `${branch.short}: General ${branch.cutoffs.general}, SC ${branch.cutoffs.sc}, OBC ${branch.cutoffs.obc}, ST ${branch.cutoffs.st}\n`;
        }
    }
    else if (context.topic === 'placement' && context.branch) {
        const branch = KNOWLEDGE_BASE.branches.find(b => b.name === context.branch);
        if (branch) {
            relevantText += `${branch.name} Placement:\n`;
            relevantText += `Rate: ${branch.placement}\n`;
            relevantText += `Average Package: ${branch.avgPackage}\n`;
            relevantText += `Highest Package: ${branch.highestPackage}\n`;
        }
    }
    else if (context.topic === 'placement') {
        relevantText += `Overall Placement: ${KNOWLEDGE_BASE.placement.overall}\n`;
        relevantText += `Highest: ${KNOWLEDGE_BASE.placement.highest}\n`;
        relevantText += `Average: ${KNOWLEDGE_BASE.placement.average}\n`;
        relevantText += `Top Recruiters: ${KNOWLEDGE_BASE.placement.recruiters.join(', ')}`;
    }
    else if (context.topic === 'fee' && context.branch) {
        relevantText += `${context.branch} Fees: ${KNOWLEDGE_BASE.fees.btech}\n`;
        if (context.category === 'sc') relevantText += `SC: ${KNOWLEDGE_BASE.scholarships.sc}\n`;
        else if (context.category === 'obc') relevantText += `OBC: ${KNOWLEDGE_BASE.scholarships.obc}\n`;
    }
    else if (context.topic === 'fee') {
        relevantText += `B.Tech Fees: ${KNOWLEDGE_BASE.fees.btech}\n`;
        relevantText += `Hostel: Single ${KNOWLEDGE_BASE.fees.hostel.single}, Double ${KNOWLEDGE_BASE.fees.hostel.double}, Triple ${KNOWLEDGE_BASE.fees.hostel.triple}\n`;
        relevantText += `Transport: ${KNOWLEDGE_BASE.fees.transport}\n`;
        relevantText += `Mess: ${KNOWLEDGE_BASE.fees.mess}\n`;
        if (context.category === 'sc') relevantText += `SC: ${KNOWLEDGE_BASE.scholarships.sc}\n`;
        else if (context.category === 'obc') relevantText += `OBC: ${KNOWLEDGE_BASE.scholarships.obc}\n`;
    }
    else if (context.topic === 'scholarship') {
        relevantText += `Scholarships:\n`;
        relevantText += `SC: ${KNOWLEDGE_BASE.scholarships.sc}\n`;
        relevantText += `ST: ${KNOWLEDGE_BASE.scholarships.st}\n`;
        relevantText += `OBC: ${KNOWLEDGE_BASE.scholarships.obc}\n`;
        relevantText += `Merit: ${KNOWLEDGE_BASE.scholarships.merit}\n`;
    }
    else if (context.topic === 'hostel') {
        relevantText += `Hostel:\n`;
        relevantText += `Boys: ${KNOWLEDGE_BASE.hostel.boys}\n`;
        relevantText += `Girls: ${KNOWLEDGE_BASE.hostel.girls}\n`;
        relevantText += `Fees: ${KNOWLEDGE_BASE.fees.hostel.single} (single), ${KNOWLEDGE_BASE.fees.hostel.double} (double), ${KNOWLEDGE_BASE.fees.hostel.triple} (triple)\n`;
        relevantText += `Amenities: ${KNOWLEDGE_BASE.hostel.amenities.join(', ')}\n`;
    }
    else if (context.topic === 'branch') {
        relevantText += "B.Tech Branches:\n";
        for (const branch of KNOWLEDGE_BASE.branches) {
            relevantText += `${branch.name} (${branch.short}): ${branch.seats} seats, ${branch.placement} placement, ${branch.avgPackage}\n`;
        }
    }
    else if (context.topic === 'contact') {
        relevantText += `Contact: ${KNOWLEDGE_BASE.college.contact}\n`;
        relevantText += `Email: ${KNOWLEDGE_BASE.college.email}\n`;
        relevantText += `Address: ${KNOWLEDGE_BASE.college.location}\n`;
    }
    else if (context.topic === 'dates') {
        relevantText += `Important Dates 2026:\n`;
        relevantText += `Apply: ${KNOWLEDGE_BASE.dates.applicationStart} - ${KNOWLEDGE_BASE.dates.applicationEnd}\n`;
        relevantText += `Exam: ${KNOWLEDGE_BASE.dates.exam}\n`;
        relevantText += `Counseling: ${KNOWLEDGE_BASE.dates.counselingStart} - ${KNOWLEDGE_BASE.dates.counselingEnd}\n`;
        relevantText += `Classes: ${KNOWLEDGE_BASE.dates.classesStart}\n`;
    }
    else if (context.topic === 'about') {
        relevantText += `About Sanjivani College:\n`;
        relevantText += `Established: ${KNOWLEDGE_BASE.college.established}\n`;
        relevantText += `Accreditation: ${KNOWLEDGE_BASE.college.accreditation}\n`;
        relevantText += `Location: ${KNOWLEDGE_BASE.college.location}\n`;
        relevantText += `Campus: ${KNOWLEDGE_BASE.college.campus}\n`;
    }

    return { text: relevantText, context };
}

// ============= FAST OLLAMA WITH RAG =============
async function callOllama(prompt) {
    try {
        const response = await axios.post(
            'http://localhost:11434/api/generate',
            {
                model: 'phi3',
                prompt: prompt,
                stream: false,
                temperature: 0.2,
                num_predict: 200,
                top_k: 20,
                top_p: 0.85,
                num_threads: 8
            },
            {
                timeout: 150000
            }
        );
        
        if (response.data && response.data.response) {
            return response.data.response.trim();
        }
        return null;
    } catch (error) {
        console.log('Ollama error:', error.message);
        return null;
    }
}

// ============= GENERATE RESPONSE =============
async function generateResponse(message, history) {
    const lowerMsg = message.toLowerCase().trim();
    
    // 1. CHECK CACHE
    if (responseCache.has(lowerMsg)) {
        return { reply: responseCache.get(lowerMsg), usedAI: false, speed: 'cache' };
    }
    
    // 2. GREETING
    if (lowerMsg.match(/^(hi|hello|hey|hii|greetings)$/)) {
        const greeting = "👋 Hello! I'm your Sanjivani College AI Assistant. I can help you with branches, fees, placements, cutoffs, scholarships, hostels, and more. What would you like to know?";
        responseCache.set(lowerMsg, greeting);
        return { reply: greeting, usedAI: false, speed: 'instant' };
    }
    
    // 3. RAG: RETRIEVE RELEVANT INFO
    const { text: relevantInfo, context } = retrieveRelevantInfo(message);
    
    // 4. BUILD CONVERSATION HISTORY
    let historyText = '';
    for (const msg of history.slice(-3)) {
        historyText += `User: ${msg.user}\nAssistant: ${msg.bot}\n`;
    }
    
    // 5. BUILD SMART PROMPT (ONLY RELEVANT INFO)
    let prompt = `You are an AI assistant for Sanjivani College of Engineering. Answer based ONLY on the information below.

RELEVANT INFORMATION:
${relevantInfo || "No specific information found. Use general knowledge below."}

${historyText ? `CONVERSATION HISTORY:\n${historyText}` : ''}

User: ${message}
Assistant:`;

    // 6. TRY AI
    try {
        const aiResponse = await callOllama(prompt);
        if (aiResponse && aiResponse.length > 3) {
            responseCache.set(lowerMsg, aiResponse);
            return { reply: aiResponse, usedAI: true, speed: 'ai' };
        }
    } catch (error) {
        console.log('AI failed:', error.message);
    }
    
    // 7. FALLBACK
    const fallback = "I can help with Sanjivani College. What would you like to know about?";
    responseCache.set(lowerMsg, fallback);
    return { reply: fallback, usedAI: false, speed: 'fallback' };
}

// ============= API =============

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    const session = sessionId || `session_${Date.now()}`;
    
    console.log(`\nUser: "${message}"`);
    
    if (!message || message.trim().length === 0) {
        return res.json({ reply: "Please enter a question. I'm here to help!" });
    }
    
    const history = getHistory(session);
    const response = await generateResponse(message, history);
    
    saveToHistory(session, message, response.reply);
    
    try {
        let conversation = await Conversation.findOne({ sessionId: session });
        if (!conversation) {
            conversation = new Conversation({ sessionId: session, messages: [] });
        }
        conversation.messages.push(
            { role: 'user', content: message, timestamp: new Date() },
            { role: 'assistant', content: response.reply, timestamp: new Date() }
        );
        conversation.metadata.totalQueries += 1;
        conversation.lastActive = new Date();
        if (conversation.messages.length > 30) {
            conversation.messages = conversation.messages.slice(-30);
        }
        await conversation.save();
    } catch (err) {}
    
    res.json({
        reply: response.reply,
        sessionId: session,
        aiModel: response.usedAI ? 'Phi-3 + RAG' : 'Instant',
        speed: response.speed
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        college: 'Sanjivani College of Engineering',
        aiModel: 'Phi-3 + RAG',
        cacheSize: responseCache.size,
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
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📦 Cache Size: ${responseCache.size} responses cached`);
    console.log(`💾 Database: ${mongoose.connection.readyState === 1 ? 'MongoDB Connected' : 'Memory Mode'}`);
});