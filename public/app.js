// ==========================================
// LINGUA CONNECT — Full-stack client
// ==========================================

const LANGUAGES = [
    { id: 'arabic', name: 'Arabic', flag: '🇸🇦' },
    { id: 'bengali', name: 'Bengali', flag: '🇧🇩' },
    { id: 'chinese', name: 'Chinese', flag: '🇨🇳' },
    { id: 'dutch', name: 'Dutch', flag: '🇳🇱' },
    { id: 'english', name: 'English', flag: '🇬🇧' },
    { id: 'french', name: 'French', flag: '🇫🇷' },
    { id: 'german', name: 'German', flag: '🇩🇪' },
    { id: 'hindi', name: 'Hindi', flag: '🇮🇳' },
    { id: 'italian', name: 'Italian', flag: '🇮🇹' },
    { id: 'japanese', name: 'Japanese', flag: '🇯🇵' },
    { id: 'korean', name: 'Korean', flag: '🇰🇷' },
    { id: 'polish', name: 'Polish', flag: '🇵🇱' },
    { id: 'portuguese', name: 'Portuguese', flag: '🇧🇷' },
    { id: 'russian', name: 'Russian', flag: '🇷🇺' },
    { id: 'spanish', name: 'Spanish', flag: '🇪🇸' },
    { id: 'thai', name: 'Thai', flag: '🇹🇭' },
    { id: 'turkish', name: 'Turkish', flag: '🇹🇷' },
    { id: 'vietnamese', name: 'Vietnamese', flag: '🇻🇳' },
];

const EMOJIS = ['👍','👏','❤️','🔥','😂','😍','🎉','💯','🤔','😮','👋','✌️','🙌','💪','🤝','⭐'];

// ==========================================
// AUTH MODULE
// ==========================================
const Auth = {
    token: localStorage.getItem('lc_token'),
    user: JSON.parse(localStorage.getItem('lc_user') || 'null'),

    isLoggedIn() { return !!this.token && !!this.user; },

    save(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('lc_token', token);
        localStorage.setItem('lc_user', JSON.stringify(user));
    },

    clear() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('lc_token');
        localStorage.removeItem('lc_user');
    },

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        return headers;
    },

    async signup(username, email, password) {
        const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.save(data.token, data.user);
        return data;
    },

    async login(email, password) {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.save(data.token, data.user);
        return data;
    },

    async googleLogin(credential) {
        const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.save(data.token, data.user);
        return data;
    },

    async verifyToken() {
        if (!this.token) return false;
        try {
            const res = await fetch('/api/auth/me', { headers: this.getHeaders() });
            if (!res.ok) { this.clear(); return false; }
            const data = await res.json();
            this.user = data.user;
            localStorage.setItem('lc_user', JSON.stringify(data.user));
            return true;
        } catch { this.clear(); return false; }
    },

    async updateProfile(data) {
        const res = await fetch('/api/auth/profile', { method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(data) });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        this.user = result.user;
        localStorage.setItem('lc_user', JSON.stringify(result.user));
        return result.user;
    },

    async deleteAccount() {
        const res = await fetch('/api/auth/account', { method: 'DELETE', headers: this.getHeaders() });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
        this.logout();
    },

    logout() {
        this.clear();
        if (SocketClient.socket) { SocketClient.socket.disconnect(); SocketClient.socket = null; }
        Voice.cleanup();
        UI.updateAuthState();
        exitRoomView();
        showNotification('Logged out successfully');
    }
};

// ==========================================
// API MODULE
// ==========================================
const API = {
    async getRooms() { const res = await fetch('/api/rooms'); const d = await res.json(); if (!res.ok) throw new Error(d.error); return d.rooms; },
    async getRoom(id) { const res = await fetch(`/api/rooms/${id}`); const d = await res.json(); if (!res.ok) throw new Error(d.error); return d; },
    async createRoom(roomData) { const res = await fetch('/api/rooms', { method: 'POST', headers: Auth.getHeaders(), body: JSON.stringify(roomData) }); const d = await res.json(); if (!res.ok) throw new Error(d.error); return d.room; },
};

// ==========================================
// SOCKET CLIENT
// ==========================================
const SocketClient = {
    socket: null,
    currentRoomId: null,

    connect() {
        if (!Auth.isLoggedIn()) return;
        if (this.socket?.connected) return;
        this.socket = io({ auth: { token: Auth.token } });

        this.socket.on('connect', () => {
            console.log('✓ Socket connected');
            document.getElementById('connection-status')?.classList.add('hidden');
        });
        this.socket.on('disconnect', () => {
            const s = document.getElementById('connection-status');
            if (s) { s.classList.remove('hidden'); s.querySelector('.connection-text').textContent = 'Reconnecting...'; }
        });
        this.socket.on('reconnect', () => {
            document.getElementById('connection-status')?.classList.add('hidden');
            if (this.currentRoomId) this.socket.emit('join-room', this.currentRoomId);
        });

        // Chat
        this.socket.on('new-message', msg => RoomView.appendMessage(msg));
        this.socket.on('user-joined', ({ user, participants, participantCount }) => {
            RoomView.updateParticipants(participants);
            if (user.id !== Auth.user?.id) RoomView.appendSystemMessage(`${user.username} joined the room`);
            Rooms.loadRooms();
        });
        this.socket.on('user-left', ({ user, participants, participantCount }) => {
            RoomView.updateParticipants(participants);
            if (user.id !== Auth.user?.id) RoomView.appendSystemMessage(`${user.username} left the room`);
            Rooms.loadRooms();
        });

        // Voice
        this.socket.on('voice-peers', peers => Voice.onPeersList(peers));
        this.socket.on('voice-peer-joined', peer => Voice.onPeerJoined(peer));
        this.socket.on('voice-peer-left', peer => Voice.onPeerLeft(peer));
        this.socket.on('webrtc-offer', data => Voice.onOffer(data));
        this.socket.on('webrtc-answer', data => Voice.onAnswer(data));
        this.socket.on('webrtc-ice-candidate', data => Voice.onIceCandidate(data));
        // Screen share state signals
        this.socket.on('screen-share-started', ({ socketId, username }) => {
            const peer = Voice.peers.get(socketId);
            if (peer) {
                peer.isScreenSharing = true;
                // If video track already arrived (ontrack fired before this event), show it now
                const videoStream = peer.videoStream || (peer.stream && peer.stream.getVideoTracks().length > 0 ? peer.stream : null);
                if (videoStream) {
                    RoomView.showScreenShare(videoStream, username);
                }
                // Otherwise ontrack will fire later and route it via peer.isScreenSharing flag
            }
        });
        this.socket.on('screen-share-stopped', ({ socketId }) => {
            const peer = Voice.peers.get(socketId);
            if (peer) {
                peer.isScreenSharing = false;
                peer.videoStream = null;
            }
            RoomView.hideScreenShare();
        });


        // Room moderation events
        this.socket.on('room-role-update', ({ userId, role }) => {
            const p = RoomView.participants.find(p => p.id === userId);
            if (p) {
                p.room_role = role;
                RoomView.updateParticipants(RoomView.participants);
            }
        });
        this.socket.on('user-kicked', ({ userId }) => {
            RoomView.participants = RoomView.participants.filter(p => p.id !== userId);
            RoomView.updateParticipants(RoomView.participants);
        });
        this.socket.on('you-were-kicked', ({ byUsername }) => {
            showNotification(`⛔ You were kicked by ${byUsername}`);
            exitRoomView();
        });
        this.socket.on('you-were-muted', ({ muted, byUsername }) => {
            if (muted && Voice.isInVoice && !Voice.isMuted) {
                Voice.toggleMute();
                showNotification(`🔇 ${byUsername} muted you`);
            }
        });
        this.socket.on('user-muted', ({ userId, muted }) => {
            const p = RoomView.participants.find(p => p.id === userId);
            if (p) { p._muted = muted; }
        });

        // DM events
        this.socket.on('dm-message', (payload) => DM.onIncoming(payload));
        this.socket.on('dm-message-sent', (payload) => DM.onSent(payload));
        this.socket.on('dm-typing', ({ fromUsername }) => DM.showTyping(fromUsername));
    },

    joinRoom(roomId) { if (!this.socket) return; this.currentRoomId = roomId; this.socket.emit('join-room', roomId); },
    leaveRoom(roomId) { if (!this.socket) return; this.socket.emit('leave-room', roomId); this.currentRoomId = null; },
    sendMessage(roomId, content) { if (!this.socket) return; this.socket.emit('send-message', { roomId, content }); },
};

// ==========================================
// MEDIA MODULE (Voice + Video + Screen Share via WebRTC)
// ==========================================
const AudioVisualizer = {
    audioCtx: null,
    analyzers: new Map(),
    animationIds: new Map(),

    init() {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    },

    attach(userId, stream) {
        this.init();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        this.detach(userId);
        try {
            const source = this.audioCtx.createMediaStreamSource(stream);
            const analyzer = this.audioCtx.createAnalyser();
            analyzer.fftSize = 64; 
            analyzer.smoothingTimeConstant = 0.7;
            source.connect(analyzer);
            this.analyzers.set(userId, analyzer);
            this.startLoop(userId);
        } catch(e) {
            console.error("AudioVisualizer attach error:", e);
        }
    },

    detach(userId) {
        this.analyzers.delete(userId);
        if (this.animationIds.has(userId)) {
            cancelAnimationFrame(this.animationIds.get(userId));
            this.animationIds.delete(userId);
        }
        const viz = document.getElementById(`viz-${userId}`);
        if (viz) {
            viz.classList.add('hidden');
            const bars = viz.querySelectorAll('.viz-bar');
            bars.forEach(b => b.style.height = '4px');
        }
        const avatar = document.querySelector(`.rv-p-avatar[data-uid="${userId}"]`);
        if (avatar) avatar.classList.remove('speaking');
    },

    detachAll() {
        for (const userId of this.analyzers.keys()) {
            this.detach(userId);
        }
    },

    startLoop(userId) {
        const analyzer = this.analyzers.get(userId);
        if (!analyzer) return;
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        
        const loop = () => {
            if (!this.analyzers.has(userId)) return;
            analyzer.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for(let i=0; i<8; i++) sum += dataArray[i];
            const avg = sum / 8;

            const viz = document.getElementById(`viz-${userId}`);
            const avatar = document.querySelector(`.rv-p-avatar[data-uid="${userId}"]`);
            const isSelf = Auth.user && userId === Auth.user.id;
            const isTrulyMuted = isSelf && Voice.isMuted;

            if (viz) {
                if (avg > 5 && !isTrulyMuted) {
                    viz.classList.remove('hidden');
                    const bars = viz.querySelectorAll('.viz-bar');
                    for(let i=0; i<bars.length; i++) {
                        const val = dataArray[i] || 0;
                        const height = 4 + (val / 255) * 24;
                        bars[i].style.height = `${height}px`;
                    }
                    if (avatar && !avatar.classList.contains('speaking')) avatar.classList.add('speaking');
                } else {
                    viz.classList.add('hidden');
                    const bars = viz.querySelectorAll('.viz-bar');
                    bars.forEach(b => b.style.height = '4px');
                    if (avatar) avatar.classList.remove('speaking');
                }
            }

            this.animationIds.set(userId, requestAnimationFrame(loop));
        };
        loop();
    }
};

const Voice = {
    localStream: null,
    screenStream: null,
    peers: new Map(),
    isMuted: false,
    isInVoice: false,
    isCameraOn: false,
    isScreenSharing: false,
    iceServers: null,

    async fetchIceServers() {
        if (this.iceServers) return; // already cached
        try {
            const res = await fetch('/api/ice-servers');
            const data = await res.json();
            this.iceServers = data.iceServers;
            console.log('✓ ICE servers loaded:', this.iceServers.length, 'servers');
        } catch (e) {
            console.warn('Failed to fetch ICE servers, using STUN only:', e);
            this.iceServers = [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ];
        }
    },

    async joinVoice(roomId) {
        try {
            await this.fetchIceServers();
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.isInVoice = true;
            this.isMuted = false;
            if (Auth.user) AudioVisualizer.attach(Auth.user.id, this.localStream);
            SocketClient.socket.emit('voice-join', roomId);
            this.updateToolbarUI();
            showNotification('🎙️ Joined voice channel');
        } catch (err) {
            console.error('Mic error:', err);
            showNotification('⚠️ Could not access microphone');
        }
    },

    leaveVoice(roomId) {
        for (const [, peer] of this.peers) peer.pc.close();
        this.peers.clear();
        AudioVisualizer.detachAll();
        if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
        this.isInVoice = false;
        this.isMuted = false;
        this.isCameraOn = false;
        this.isScreenSharing = false;
        if (roomId) SocketClient.socket?.emit('voice-leave', roomId);
        this.updateToolbarUI();
        RoomView.updateParticipantVoice();
        RoomView.updateLocalVideo(null);
    },

    toggleMute() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.isMuted; });
        this.updateToolbarUI();
        RoomView.updateParticipantVoice();
    },

    async toggleCamera() {
        if (!this.isInVoice) {
            showNotification('⚠️ Join voice first to enable camera');
            return;
        }
        if (!this.isCameraOn) {
            try {
                const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
                const videoTrack = camStream.getVideoTracks()[0];
                // Add video track to local stream
                this.localStream.addTrack(videoTrack);
                // Replace track on all peer connections
                for (const [, peer] of this.peers) {
                    const senders = peer.pc.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender) {
                        await videoSender.replaceTrack(videoTrack);
                    } else {
                        peer.pc.addTrack(videoTrack, this.localStream);
                    }
                }
                this.isCameraOn = true;
                RoomView.updateLocalVideo(camStream);
                showNotification('📹 Camera on');
            } catch (err) {
                console.error('Camera error:', err);
                showNotification('⚠️ Could not access camera');
            }
        } else {
            // Turn off camera
            const videoTracks = this.localStream.getVideoTracks();
            videoTracks.forEach(t => { t.stop(); this.localStream.removeTrack(t); });
            for (const [, peer] of this.peers) {
                const senders = peer.pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    try { peer.pc.removeTrack(videoSender); } catch(e) {}
                }
            }
            this.isCameraOn = false;
            RoomView.updateLocalVideo(null);
            showNotification('📹 Camera off');
        }
        this.updateToolbarUI();
    },

    async toggleScreenShare() {
        if (!this.isInVoice) {
            showNotification('⚠️ Join voice first to share screen');
            return;
        }
        if (!this.isScreenSharing) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
                const screenTrack = this.screenStream.getVideoTracks()[0];
                // When user stops sharing via browser UI
                screenTrack.onended = () => { this.stopScreenShare(); };
                // Replace or add video track on all peers, then renegotiate
                for (const [socketId, peer] of this.peers) {
                    const senders = peer.pc.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender) {
                        await videoSender.replaceTrack(screenTrack);
                    } else {
                        peer.pc.addTrack(screenTrack, this.screenStream);
                    }
                    // Renegotiate: create a new offer so the remote peer gets the new video track
                    try {
                        const offer = await peer.pc.createOffer();
                        await peer.pc.setLocalDescription(offer);
                        SocketClient.socket.emit('webrtc-offer', { to: socketId, offer });
                    } catch (e) {
                        console.error('Renegotiation offer error:', e);
                    }
                }
                this.isScreenSharing = true;
                RoomView.showScreenShare(this.screenStream);
                // Notify all peers in room that screen sharing started
                if (SocketClient.currentRoomId) {
                    SocketClient.socket.emit('screen-share-started', { roomId: SocketClient.currentRoomId });
                }
                showNotification('📺 Screen sharing started');
            } catch (err) {
                if (err.name !== 'NotAllowedError') {
                    console.error('Screen share error:', err);
                    showNotification('⚠️ Could not share screen');
                }
            }
        } else {
            this.stopScreenShare();
        }
        this.updateToolbarUI();
    },

    async stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        // If camera was on, replace screen track with camera; otherwise remove video sender
        if (this.isCameraOn && this.localStream) {
            const camTrack = this.localStream.getVideoTracks()[0];
            if (camTrack) {
                for (const [socketId, peer] of this.peers) {
                    const senders = peer.pc.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender) {
                        await videoSender.replaceTrack(camTrack);
                        // Renegotiate
                        try {
                            const offer = await peer.pc.createOffer();
                            await peer.pc.setLocalDescription(offer);
                            SocketClient.socket.emit('webrtc-offer', { to: socketId, offer });
                        } catch (e) { console.error('Renegotiation error:', e); }
                    }
                }
            }
        } else {
            for (const [socketId, peer] of this.peers) {
                const senders = peer.pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    try { peer.pc.removeTrack(videoSender); } catch(e) {}
                    // Renegotiate after removing track
                    try {
                        const offer = await peer.pc.createOffer();
                        await peer.pc.setLocalDescription(offer);
                        SocketClient.socket.emit('webrtc-offer', { to: socketId, offer });
                    } catch (e) { console.error('Renegotiation error:', e); }
                }
            }
        }
        this.isScreenSharing = false;
        RoomView.hideScreenShare();
        this.updateToolbarUI();
        // Notify peers that screen sharing stopped
        if (SocketClient.currentRoomId) {
            SocketClient.socket.emit('screen-share-stopped', { roomId: SocketClient.currentRoomId });
        }
        showNotification('📺 Screen sharing stopped');
    },

    updateToolbarUI() {
        const micBtn = document.getElementById('rv-mic-btn');
        const camBtn = document.getElementById('rv-cam-btn');
        const screenBtn = document.getElementById('rv-screen-btn');
        if (micBtn && this.isInVoice) {
            if (this.isMuted) {
                micBtn.classList.add('muted');
                micBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.5-.35 2.18"/></svg>';
            } else {
                micBtn.classList.remove('muted');
                micBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>';
            }
        }
        if (camBtn) {
            camBtn.classList.toggle('active', this.isCameraOn);
        }
        if (screenBtn) {
            screenBtn.classList.toggle('active', this.isScreenSharing);
        }
    },

    createPeerConnection(socketId, username) {
        const pc = new RTCPeerConnection({
            iceServers: this.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        });
        if (this.localStream) this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        if (this.screenStream) this.screenStream.getTracks().forEach(track => pc.addTrack(track, this.screenStream));
        pc.ontrack = (event) => {
            const peer = this.peers.get(socketId);
            if (!peer) return;
            const stream = event.streams[0];
            const track = event.track;

            if (track.kind === 'audio') {
                peer.stream = peer.stream || stream;
                const participant = RoomView.participants.find(pt => pt.username === peer.username);
                if (participant) AudioVisualizer.attach(participant.id, stream);
                let audio = document.getElementById(`audio-${socketId}`);
                if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${socketId}`; audio.autoplay = true; document.body.appendChild(audio); }
                audio.srcObject = stream;
            }

            if (track.kind === 'video') {
                peer.videoStream = stream;
                if (peer.isScreenSharing) {
                    RoomView.showScreenShare(stream, peer.username);
                } else {
                    RoomView.updatePeerVideo(socketId, stream);
                }
            }
            RoomView.updateParticipantVoice();
        };

        // Log connection state changes — visible in browser DevTools console
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] ${username} connection state: ${pc.connectionState}`);
            if (pc.connectionState === 'failed') {
                console.error(`[WebRTC] Connection FAILED for ${username} — ICE negotiation unsuccessful. Check TURN server.`);
            }
        };
        pc.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ${username} ICE state: ${pc.iceConnectionState}`);
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) SocketClient.socket.emit('webrtc-ice-candidate', { to: socketId, candidate: e.candidate });
        };

        // pendingCandidates queue: holds ICE candidates that arrived before
        // setRemoteDescription — they are flushed in onOffer / onAnswer
        this.peers.set(socketId, { pc, stream: null, username, pendingCandidates: [] });
        return pc;
    },

    async onPeersList(peers) {
        for (const peer of peers) {
            const pc = this.createPeerConnection(peer.socketId, peer.username);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            SocketClient.socket.emit('webrtc-offer', { to: peer.socketId, offer });
        }
        RoomView.updateParticipantVoice();
    },

    onPeerJoined(peer) {
        this.createPeerConnection(peer.socketId, peer.username);
        RoomView.updateParticipantVoice();
        RoomView.appendSystemMessage(`🎙️ ${peer.username} joined voice`);
    },

    onPeerLeft(peer) {
        const p = this.peers.get(peer.socketId);
        if (p) { p.pc.close(); this.peers.delete(peer.socketId); const a = document.getElementById(`audio-${peer.socketId}`); if (a) a.remove(); }
        const participant = RoomView.participants.find(pt => pt.username === peer.username);
        if (participant) AudioVisualizer.detach(participant.id);
        RoomView.updateParticipantVoice();
        RoomView.appendSystemMessage(`🔇 ${peer.username} left voice`);
    },

    async onOffer({ from, offer, username }) {
        const pc = this.peers.has(from) ? this.peers.get(from).pc : this.createPeerConnection(from, username);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            // Flush any ICE candidates that arrived before the remote description was ready
            const peer = this.peers.get(from);
            if (peer && peer.pendingCandidates.length > 0) {
                console.log(`[WebRTC] Flushing ${peer.pendingCandidates.length} queued ICE candidates for ${username}`);
                for (const c of peer.pendingCandidates) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) { console.warn('[WebRTC] Queued candidate error:', e); }
                }
                peer.pendingCandidates = [];
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            SocketClient.socket.emit('webrtc-answer', { to: from, answer });
        } catch(e) {
            console.error('[WebRTC] onOffer error:', e);
        }
    },

    async onAnswer({ from, answer }) {
        const peer = this.peers.get(from);
        if (!peer) return;
        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
            // Flush any ICE candidates that arrived before the remote description was ready
            if (peer.pendingCandidates.length > 0) {
                console.log(`[WebRTC] Flushing ${peer.pendingCandidates.length} queued ICE candidates for ${peer.username}`);
                for (const c of peer.pendingCandidates) {
                    try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) { console.warn('[WebRTC] Queued candidate error:', e); }
                }
                peer.pendingCandidates = [];
            }
        } catch(e) {
            console.error('[WebRTC] onAnswer error:', e);
        }
    },

    async onIceCandidate({ from, candidate }) {
        const peer = this.peers.get(from);
        if (!peer || !candidate) return;
        // If remote description not set yet, queue the candidate — this is the race condition fix
        if (!peer.pc.remoteDescription || !peer.pc.remoteDescription.type) {
            console.log(`[WebRTC] Queuing ICE candidate for ${peer.username} (remote description not ready yet)`);
            peer.pendingCandidates.push(candidate);
        } else {
            try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
            catch(e) { console.warn('[WebRTC] addIceCandidate error:', e); }
        }
    },

    cleanup() { this.leaveVoice(null); }
};

// ==========================================
// ROOMS MODULE
// ==========================================
const Rooms = {
    allRooms: [],
    currentFilter: 'all',

    async loadRooms() {
        try {
            this.allRooms = await API.getRooms();
            this.renderRooms();
            this.renderLangFilterBar();
        } catch (err) {
            console.error('Failed to load rooms:', err);
            const grid = document.getElementById('rooms-grid');
            if (grid) grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1;">Unable to load rooms.</p>';
        }
    },

    renderLangFilterBar() {
        const container = document.getElementById('lang-filter-tags');
        if (!container) return;

        // Count rooms per language
        const counts = {};
        let total = this.allRooms.length;
        this.allRooms.forEach(r => { counts[r.language] = (counts[r.language] || 0) + 1; });

        let html = `<span class="lang-tag ${this.currentFilter === 'all' ? 'active' : ''}" data-lang="all">All (${total})</span>`;
        LANGUAGES.forEach(lang => {
            const count = counts[lang.id] || 0;
            html += `<span class="lang-tag ${this.currentFilter === lang.id ? 'active' : ''}" data-lang="${lang.id}">${lang.flag} ${lang.name} (${count})</span>`;
        });

        container.innerHTML = html;

        container.querySelectorAll('.lang-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                this.currentFilter = tag.dataset.lang;
                this.renderRooms();
                container.querySelectorAll('.lang-tag').forEach(t => t.classList.toggle('active', t.dataset.lang === this.currentFilter));
            });
        });
    },

    renderRooms() {
        const filtered = this.currentFilter === 'all' ? this.allRooms : this.allRooms.filter(r => r.language === this.currentFilter);
        const grid = document.getElementById('rooms-grid');
        if (!grid) return;

        if (filtered.length === 0) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);grid-column:1/-1;padding:3rem 0;">No rooms found for this language. Create one!</p>';
            return;
        }

        grid.innerHTML = filtered.map((room, i) => {
            const pCount = room.participant_count || 0;
            const maxP = room.max_participants || 10;
            const isFull = pCount >= maxP;
            const typeLabel = room.type === 'voice' ? '🎙️ Voice' : room.type === 'text' ? '💬 Text' : '🎙️💬 Both';
            const levelLabel = room.level && room.level !== 'any' ? room.level.charAt(0).toUpperCase() + room.level.slice(1) : 'Any Level';
            const langInfo = LANGUAGES.find(l => l.id === room.language);
            const colors = room.colors && room.colors.length > 0 ? room.colors : ['#6366f1'];

            return `
            <div class="room-card reveal reveal-delay-${(i % 4) + 1}" data-room-id="${room.id}">
                <div class="room-card-top">
                    <span class="room-flag">${langInfo ? langInfo.flag : room.flag || '🌐'}</span>
                    <span class="room-type ${room.type}">${typeLabel}</span>
                </div>
                <div class="room-name">${escapeHtml(room.name)}</div>
                <div class="room-level">${levelLabel}</div>
                <div class="room-desc">${escapeHtml(room.description || '')}</div>
                <div class="room-card-bottom">
                    <div class="room-participants">
                        ${colors.slice(0, Math.min(4, Math.max(pCount, 0))).map(c => `<div class="room-avatar" style="background:${c}"></div>`).join('')}
                        ${pCount > 4 ? `<span class="room-count">+${pCount - 4}</span>` : ''}
                        ${pCount === 0 ? '<span class="room-count" style="margin-left:0">Empty</span>' : `<span class="room-count">♥ ${pCount}</span>`}
                    </div>
                    ${isFull
                        ? '<span class="room-full">🚫 This group is full.</span>'
                        : `<button class="room-join" data-room-id="${room.id}">🔗 Join and talk now!</button>`
                    }
                </div>
            </div>`;
        }).join('');

        observeElements();

        grid.querySelectorAll('.room-join').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this.openRoom(parseInt(btn.dataset.roomId)); });
        });
        grid.querySelectorAll('.room-card').forEach(card => {
            card.addEventListener('click', () => this.openRoom(parseInt(card.dataset.roomId)));
        });
    },

    async openRoom(roomId) {
        if (!Auth.isLoggedIn()) { UI.openLoginModal(); return; }
        try {
            const { room, messages, participants } = await API.getRoom(roomId);
            RoomView.open(room, messages, participants);
            SocketClient.connect();
            SocketClient.joinRoom(roomId);
        } catch (err) {
            console.error('Failed to open room:', err);
            showNotification('⚠️ Could not open room');
        }
    }
};

// ==========================================
// ROOM VIEW MODULE (Full-screen room experience)
// ==========================================
const RoomView = {
    room: null,
    participants: [],

    open(room, messages, participants) {
        this.room = room;
        this.participants = participants;

        // Header info
        document.getElementById('rv-title').textContent = room.name;
        const langInfo = LANGUAGES.find(l => l.id === room.language);
        document.getElementById('rv-lang').textContent = langInfo ? langInfo.name : room.language;
        const levelLabel = room.level && room.level !== 'any' ? room.level.charAt(0).toUpperCase() + room.level.slice(1) : 'Any Level';
        document.getElementById('rv-level').textContent = levelLabel;

        // Settings tab
        document.getElementById('rv-setting-desc').textContent = room.description || 'No description';
        document.getElementById('rv-setting-access').textContent = (room.access || 'open').charAt(0).toUpperCase() + (room.access || 'open').slice(1);
        const maxSelect = document.getElementById('rv-setting-max');
        if (maxSelect) maxSelect.value = room.max_participants || 10;
        const typeSelect = document.getElementById('rv-setting-type');
        if (typeSelect) typeSelect.value = room.type || 'both';
        document.getElementById('rv-setting-creator').textContent = room.creator_name || 'Unknown';

        // Messages
        const msgContainer = document.getElementById('rv-chat-messages');
        msgContainer.innerHTML = '';
        if (messages.length === 0) {
            msgContainer.innerHTML = '<div class="rv-chat-empty"><span>💬</span><p>No messages yet</p><p class="muted">Be the first to say something</p></div>';
        } else {
            messages.forEach(msg => this.appendMessage(msg));
        }

        // Participants
        this.updateParticipants(participants);

        // Reset voice state
        Voice.leaveVoice(null);

        // Show/hide voice toolbar based on room type
        const micBtn = document.getElementById('rv-mic-btn');
        if (room.type === 'text') {
            micBtn?.classList.add('hidden');
        } else {
            micBtn?.classList.remove('hidden');
        }

        // Switch to chat tab
        this.switchTab('chat');

        // Show room view, hide home
        document.getElementById('room-view').classList.remove('hidden');
        document.getElementById('home-view').style.display = 'none';
        document.getElementById('navbar').classList.add('in-room');
    },

    close() {
        if (SocketClient.currentRoomId) {
            Voice.leaveVoice(SocketClient.currentRoomId);
            SocketClient.leaveRoom(SocketClient.currentRoomId);
        }
        document.getElementById('room-view').classList.add('hidden');
        document.getElementById('home-view').style.display = '';
        document.getElementById('navbar').classList.remove('in-room');
        this.room = null;
        this.participants = [];
    },

    updateParticipants(participants) {
        this.participants = participants;
        const grid = document.getElementById('rv-participants-grid');
        const membersList = document.getElementById('rv-members-list');
        if (!grid) return;

        const myRole = Moderation.getMyRole();

        if (participants.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No one is here yet. You\'re the first!</p>';
        } else {
            grid.innerHTML = participants.map(p => {
                const role = p.room_role || (this.room && String(p.id) === String(this.room.creator_id) ? 'owner' : 'guest');
                const isYou = p.id === Auth.user?.id;
                const isMuted = isYou && Voice.isMuted;
                const avatarContent = p.avatar_url
                    ? `<img src="${escapeHtml(p.avatar_url)}" alt="${escapeHtml(p.username)}" class="rv-p-avatar-img" referrerpolicy="no-referrer">`
                    : (p.username || 'U')[0].toUpperCase();
                const roleBadge = role === 'owner' ? '<span class="role-badge owner">👑 Owner</span>'
                    : role === 'co-owner' ? '<span class="role-badge co-owner">⭐ Co-owner</span>'
                    : '';
                return `
                <div class="rv-participant" data-user-id="${p.id}" data-username="${escapeHtml(p.username)}" data-role="${role}">
                    <div class="rv-p-avatar-wrap">
                        <div class="rv-p-avatar" style="background:${p.avatar_color || '#6366f1'}" data-uid="${p.id}">
                            ${avatarContent}
                        </div>
                        <div class="rv-visualizer hidden" id="viz-${p.id}">
                            <div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div>
                        </div>
                        ${isMuted ? '<div class="rv-p-mute-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg></div>' : ''}
                    </div>
                    <span class="rv-p-name">${escapeHtml(p.username || 'User')}</span>
                    ${roleBadge}
                </div>`;
            }).join('');

            // Add right-click context menus on participant cards
            grid.querySelectorAll('.rv-participant').forEach(card => {
                card.addEventListener('contextmenu', e => {
                    e.preventDefault();
                    const userId = parseInt(card.dataset.userId);
                    const role = card.dataset.role;
                    const username = card.dataset.username;
                    if (userId === Auth.user?.id) return;
                    Moderation.showContextMenu(e.clientX, e.clientY, userId, username, role);
                });
                // Also long-press on avatar for mobile / quick profile view on click
                card.addEventListener('click', e => {
                    const userId = parseInt(card.dataset.userId);
                    if (userId !== Auth.user?.id) UserProfile.open(userId);
                });
            });
        }

        // Update members list tab
        if (membersList) {
            membersList.innerHTML = participants.map(p => {
                const role = p.room_role || (this.room && String(p.id) === String(this.room.creator_id) ? 'owner' : 'guest');
                const memberAvatarContent = p.avatar_url
                    ? `<img src="${escapeHtml(p.avatar_url)}" alt="${escapeHtml(p.username)}" class="rv-member-avatar-img" referrerpolicy="no-referrer">`
                    : (p.username||'U')[0].toUpperCase();
                const roleLabel = role === 'owner' ? '<span class="role-badge owner rv-member-role">👑 Owner</span>'
                    : role === 'co-owner' ? '<span class="role-badge co-owner rv-member-role">⭐ Co-owner</span>'
                    : '<span class="role-badge guest rv-member-role">Guest</span>';
                return `
                <div class="rv-member-item" data-user-id="${p.id}" data-role="${role}" data-username="${escapeHtml(p.username)}" style="cursor:pointer;">
                    <div class="rv-member-avatar" style="background:${p.avatar_color || '#6366f1'}">${memberAvatarContent}</div>
                    <div class="rv-member-info">
                        <div class="rv-member-name">${escapeHtml(p.username||'User')}</div>
                        ${roleLabel}
                    </div>
                </div>`;
            }).join('');

            membersList.querySelectorAll('.rv-member-item').forEach(item => {
                item.addEventListener('click', e => {
                    const userId = parseInt(item.dataset.userId);
                    if (userId !== Auth.user?.id) UserProfile.open(userId);
                });
                item.addEventListener('contextmenu', e => {
                    e.preventDefault();
                    const userId = parseInt(item.dataset.userId);
                    if (userId === Auth.user?.id) return;
                    Moderation.showContextMenu(e.clientX, e.clientY, userId, item.dataset.username, item.dataset.role);
                });
            });
        }
    },

    updateParticipantVoice() {
        // Just update mute badge for self
        if (Auth.user) {
            const selfCard = document.querySelector(`.rv-participant[data-user-id="${Auth.user.id}"]`);
            if (selfCard) {
                const existing = selfCard.querySelector('.rv-p-mute-badge');
                if (Voice.isMuted && Voice.isInVoice) {
                    if (!existing) {
                        const badge = document.createElement('div');
                        badge.className = 'rv-p-mute-badge';
                        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>';
                        selfCard.querySelector('.rv-p-avatar-wrap').appendChild(badge);
                    }
                } else if (existing) {
                    existing.remove();
                }
            }
        }
    },

    appendMessage(msg) {
        const container = document.getElementById('rv-chat-messages');
        if (!container) return;

        // Remove empty state
        const empty = container.querySelector('.rv-chat-empty');
        if (empty) empty.remove();

        const isSelf = msg.user_id === Auth.user?.id;
        const color = msg.avatar_color || '#6366f1';
        const msgAvatarContent = msg.avatar_url
            ? `<img src="${escapeHtml(msg.avatar_url)}" alt="" class="rv-msg-avatar-img" referrerpolicy="no-referrer">`
            : (msg.username || 'U')[0].toUpperCase();

        let contentHtml = escapeHtml(msg.content);
        if (msg.content.startsWith('[GIF] ')) {
            const url = msg.content.substring(6);
            if (url.startsWith('https://')) {
                contentHtml = `<div class="rv-msg-gif"><img src="${escapeHtml(url)}" alt="GIF"></div>`;
            }
        } else if (msg.content.startsWith('[STICKER] ')) {
            const url = msg.content.substring(10);
            if (url.startsWith('https://')) {
                contentHtml = `<div class="rv-msg-sticker"><img src="${escapeHtml(url)}" alt="Sticker" style="width: 120px; height: 120px; object-fit: contain; margin-top: 5px;"></div>`;
            }
        } else if (msg.content.startsWith('[IMAGE] ')) {
            const url = msg.content.substring(8);
            if (url.startsWith('https://')) {
                contentHtml = `<div class="rv-msg-media"><img src="${escapeHtml(url)}" alt="User Uploaded Image" onclick="window.open('${escapeHtml(url)}', '_blank')"></div>`;
            }
        }

        const el = document.createElement('div');
        el.className = `rv-msg ${isSelf ? 'self' : ''}`;
        el.innerHTML = `
            <div class="rv-msg-avatar" style="background:${color}">${msgAvatarContent}</div>
            <div class="rv-msg-content">
                <div class="rv-msg-name">${isSelf ? 'You' : escapeHtml(msg.username || 'User')}</div>
                <div class="rv-msg-text">${contentHtml}</div>
            </div>`;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    },

    appendSystemMessage(text) {
        const container = document.getElementById('rv-chat-messages');
        if (!container) return;
        const empty = container.querySelector('.rv-chat-empty');
        if (empty) empty.remove();
        const el = document.createElement('div');
        el.className = 'rv-msg-system';
        el.textContent = text;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    },

    switchTab(tabName) {
        document.querySelectorAll('.rv-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        document.querySelectorAll('.rv-tab-content').forEach(c => c.classList.remove('active'));
        const content = document.getElementById(`rv-content-${tabName}`);
        if (content) content.classList.add('active');
    },

    updateLocalVideo(stream) {
        if (!Auth.user) return;
        const card = document.querySelector(`.rv-participant[data-user-id="${Auth.user.id}"] .rv-p-avatar`);
        if (!card) return;
        const existing = card.querySelector('video');
        if (existing) existing.remove();
        if (stream) {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.className = 'rv-p-video';
            card.appendChild(video);
        }
    },

    updatePeerVideo(socketId, stream) {
        const peer = Voice.peers.get(socketId);
        if (!peer) return;
        // Find participant card by matching username
        const participant = this.participants.find(p => p.username === peer.username);
        if (!participant) return;
        const card = document.querySelector(`.rv-participant[data-user-id="${participant.id}"] .rv-p-avatar`);
        if (!card) return;
        const existing = card.querySelector('video');
        if (existing) existing.remove();
        if (stream && stream.getVideoTracks().length > 0) {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.className = 'rv-p-video';
            card.appendChild(video);
        }
    },

    showScreenShare(stream, sharerName) {
        let container = document.getElementById('rv-screen-share-view');
        if (!container) {
            container = document.createElement('div');
            container.id = 'rv-screen-share-view';
            container.className = 'rv-screen-share-view';
            document.querySelector('.rv-participants-area').prepend(container);
        }
        container.innerHTML = '';
        if (sharerName) {
            const label = document.createElement('div');
            label.className = 'rv-screen-share-label';
            label.textContent = `📺 ${sharerName}'s screen`;
            container.appendChild(label);
        }
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.className = 'rv-screen-video';
        container.appendChild(video);
        container.classList.remove('hidden');
    },

    hideScreenShare() {
        const container = document.getElementById('rv-screen-share-view');
        if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
    },

    sendReaction(emoji) {
        const container = document.getElementById('rv-reactions');
        if (!container) return;
        const el = document.createElement('div');
        el.className = 'rv-reaction-float';
        el.textContent = emoji;
        el.style.left = `${Math.random() * 100 - 50}px`;
        container.appendChild(el);
        setTimeout(() => el.remove(), 2000);
    }
};

function exitRoomView() {
    RoomView.close();
}

// ==========================================
// UI MODULE
// ==========================================
const UI = {
    updateAuthState() {
        const guest = document.getElementById('nav-actions-guest');
        const user = document.getElementById('nav-actions-user');
        if (Auth.isLoggedIn()) {
            guest?.classList.add('hidden');
            user?.classList.remove('hidden');
            document.getElementById('nav-username').textContent = Auth.user.username;
            const avatar = document.getElementById('nav-user-avatar');
            if (avatar) {
                if (Auth.user.avatar_url) {
                    avatar.innerHTML = `<img src="${escapeHtml(Auth.user.avatar_url)}" alt="" class="nav-avatar-img" referrerpolicy="no-referrer">`;
                } else {
                    avatar.textContent = Auth.user.username[0].toUpperCase();
                }
                avatar.style.background = Auth.user.avatar_url ? 'transparent' : (Auth.user.avatar_color || '#6366f1');
            }
            // Dropdown info
            const dAvatar = document.getElementById('dropdown-avatar');
            if (dAvatar) {
                if (Auth.user.avatar_url) {
                    dAvatar.innerHTML = `<img src="${escapeHtml(Auth.user.avatar_url)}" alt="" class="dropdown-avatar-img" referrerpolicy="no-referrer">`;
                } else {
                    dAvatar.textContent = Auth.user.username[0].toUpperCase();
                }
                dAvatar.style.background = Auth.user.avatar_url ? 'transparent' : (Auth.user.avatar_color || '#6366f1');
            }
            document.getElementById('dropdown-id').textContent = `ID: ${Auth.user.id}`;
            document.getElementById('dropdown-name').textContent = Auth.user.username;
            document.getElementById('dropdown-email').textContent = Auth.user.email;
            SocketClient.connect();
        } else {
            guest?.classList.remove('hidden');
            user?.classList.add('hidden');
        }
    },

    openLoginModal() { document.getElementById('login-modal').classList.add('open'); document.getElementById('signup-modal').classList.remove('open'); },
    openSignupModal() { document.getElementById('signup-modal').classList.add('open'); document.getElementById('login-modal').classList.remove('open'); },
    closeLoginModal() { document.getElementById('login-modal').classList.remove('open'); },
    closeSignupModal() { document.getElementById('signup-modal').classList.remove('open'); },
    closeCreateRoomModal() { document.getElementById('create-room-modal').classList.remove('open'); },
    openCreateRoomModal() { if (!Auth.isLoggedIn()) { this.openLoginModal(); return; } document.getElementById('create-room-modal').classList.add('open'); },
    openProfileModal() {
        if (!Auth.isLoggedIn()) return;
        const u = Auth.user;
        document.getElementById('profile-username').value = u.username || '';
        document.getElementById('profile-bio').value = u.bio || '';
        document.getElementById('profile-native-lang').value = u.native_lang || 'english';
        document.getElementById('profile-learning-lang').value = u.learning_lang || '';
        // Set active color swatch
        document.querySelectorAll('#color-picker .color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === (u.avatar_color || '#6366f1'));
        });
        document.getElementById('profile-modal').classList.add('open');
    },
    closeProfileModal() { document.getElementById('profile-modal').classList.remove('open'); },

    clearFormErrors(prefix) {
        document.querySelectorAll(`#${prefix}-form .form-error`).forEach(el => el.textContent = '');
        const general = document.getElementById(`${prefix}-error`);
        if (general) general.textContent = '';
    },
    showFormError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; },
    setButtonLoading(btn, loading) {
        if (loading) { btn.dataset.orig = btn.textContent; btn.textContent = 'Please wait...'; btn.disabled = true; }
        else { btn.textContent = btn.dataset.orig || btn.textContent; btn.disabled = false; }
    }
};

// ==========================================
// HELPERS
// ==========================================
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function showNotification(message) {
    document.querySelectorAll('.notification').forEach(n => n.remove());
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function observeElements() {
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
}

// Populate all select elements with LANGUAGES (flags + sorted alphabetically)
function populateLanguageSelects() {
    const selects = [
        { id: 'room-lang-select', placeholder: 'Select language...' },
        { id: 'profile-native-lang', placeholder: null },
        { id: 'profile-learning-lang', placeholder: 'Not set' },
    ];
    selects.forEach(({ id, placeholder }) => {
        const select = document.getElementById(id);
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '';
        if (placeholder !== null) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = placeholder;
            select.appendChild(opt);
        }
        LANGUAGES.forEach(lang => {
            const opt = document.createElement('option');
            opt.value = lang.id;
            opt.textContent = `${lang.flag} ${lang.name}`;
            select.appendChild(opt);
        });
        // Add "Other" at the end
        const otherOpt = document.createElement('option');
        otherOpt.value = 'other';
        otherOpt.textContent = '🌐 Other';
        select.appendChild(otherOpt);
        if (currentVal) select.value = currentVal;
    });
}

// ==========================================
// CREATE ROOM — Language tags logic
// ==========================================
const CreateRoom = {
    selectedLangs: [],

    addLang(langId) {
        if (this.selectedLangs.includes(langId) || this.selectedLangs.length >= 2) return;
        this.selectedLangs.push(langId);
        this.renderTags();
    },

    removeLang(langId) {
        this.selectedLangs = this.selectedLangs.filter(l => l !== langId);
        this.renderTags();
    },

    renderTags() {
        const container = document.getElementById('lang-tags');
        if (!container) return;
        container.innerHTML = this.selectedLangs.map(langId => {
            const info = LANGUAGES.find(l => l.id === langId);
            return `<span class="lang-tag-item">${info ? info.name : langId} <span class="lang-tag-remove" data-lang="${langId}">&times;</span></span>`;
        }).join('');
        container.querySelectorAll('.lang-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => this.removeLang(btn.dataset.lang));
        });
    },

    reset() {
        this.selectedLangs = [];
        this.renderTags();
    }
};

// ==========================================
// GOOGLE OAUTH
// ==========================================
async function initGoogleAuth() {
    if (typeof google === 'undefined' || !google.accounts) {
        setTimeout(initGoogleAuth, 2000);
        return;
    }
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (!config.googleClientId || config.googleClientId === 'YOUR_GOOGLE_CLIENT_ID_HERE') return;
        window.__googleClientId = config.googleClientId;
        google.accounts.id.initialize({ client_id: config.googleClientId, callback: handleGoogleCredential, auto_select: false, ux_mode: 'popup' });
        console.log('✓ Google Identity Services initialized');
    } catch (err) { console.error('Google OAuth init error:', err); }
}

async function handleGoogleCredential(response) {
    try {
        await Auth.googleLogin(response.credential);
        UI.closeLoginModal();
        UI.closeSignupModal();
        UI.updateAuthState();
        showNotification(`Welcome, ${Auth.user.username}! 🎉`);
    } catch (err) { showNotification('⚠️ ' + err.message); }
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
    // Auth modals
    document.getElementById('btn-login')?.addEventListener('click', () => UI.openLoginModal());
    document.getElementById('btn-signup')?.addEventListener('click', () => UI.openSignupModal());
    document.getElementById('login-modal-close')?.addEventListener('click', () => UI.closeLoginModal());
    document.getElementById('signup-modal-close')?.addEventListener('click', () => UI.closeSignupModal());
    document.getElementById('switch-to-signup')?.addEventListener('click', e => { e.preventDefault(); UI.openSignupModal(); });
    document.getElementById('switch-to-login')?.addEventListener('click', e => { e.preventDefault(); UI.openLoginModal(); });

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearFormErrors('login');
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-submit-btn');
        UI.setButtonLoading(btn, true);
        try {
            await Auth.login(email, password);
            UI.closeLoginModal();
            UI.updateAuthState();
            showNotification(`Welcome back, ${Auth.user.username}! 🎉`);
        } catch (err) { UI.showFormError('login-error', err.message); }
        finally { UI.setButtonLoading(btn, false); }
    });

    // Signup form
    document.getElementById('signup-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearFormErrors('signup');
        const username = document.getElementById('signup-username').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;
        const btn = document.getElementById('signup-submit-btn');
        if (password !== confirm) { UI.showFormError('signup-error', 'Passwords do not match'); return; }
        UI.setButtonLoading(btn, true);
        try {
            await Auth.signup(username, email, password);
            UI.closeSignupModal();
            UI.updateAuthState();
            showNotification(`Welcome, ${Auth.user.username}! 🎉`);
        } catch (err) { UI.showFormError('signup-error', err.message); }
        finally { UI.setButtonLoading(btn, false); }
    });

    // Google OAuth
    document.getElementById('btn-google-login')?.addEventListener('click', () => {
        if (typeof google !== 'undefined' && google.accounts && window.__googleClientId) {
            google.accounts.id.prompt(n => { if (n.isNotDisplayed() || n.isSkippedMoment()) showNotification('ℹ️ Google popup was blocked.'); });
        } else { showNotification('⚠️ Google sign-in not available.'); }
    });
    document.getElementById('btn-google-signup')?.addEventListener('click', () => {
        if (typeof google !== 'undefined' && google.accounts && window.__googleClientId) {
            google.accounts.id.prompt(n => { if (n.isNotDisplayed() || n.isSkippedMoment()) showNotification('ℹ️ Google popup was blocked.'); });
        } else { showNotification('⚠️ Google sign-in not available.'); }
    });

    // User dropdown
    document.getElementById('nav-user-trigger')?.addEventListener('click', () => {
        const dd = document.getElementById('user-dropdown');
        dd?.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
        const trigger = document.getElementById('nav-user-trigger');
        const dd = document.getElementById('user-dropdown');
        if (dd && trigger && !trigger.contains(e.target) && !dd.contains(e.target)) {
            dd.classList.add('hidden');
        }
    });
    document.getElementById('dropdown-profile')?.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.add('hidden');
        UI.openProfileModal();
    });
    document.getElementById('dropdown-settings')?.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.add('hidden');
        UI.openProfileModal();
    });
    document.getElementById('dropdown-logout')?.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.add('hidden');
        Auth.logout();
    });
    document.getElementById('dropdown-delete')?.addEventListener('click', async () => {
        document.getElementById('user-dropdown').classList.add('hidden');
        if (confirm('Are you sure you want to delete your account? This cannot be undone.')) {
            try { await Auth.deleteAccount(); showNotification('Account deleted.'); } catch (err) { showNotification('⚠️ ' + err.message); }
        }
    });

    // Profile modal
    document.getElementById('profile-modal-close')?.addEventListener('click', () => UI.closeProfileModal());
    document.querySelectorAll('#color-picker .color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('#color-picker .color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
        });
    });
    document.getElementById('profile-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const activeColor = document.querySelector('#color-picker .color-swatch.active');
        try {
            await Auth.updateProfile({
                username: document.getElementById('profile-username').value.trim(),
                bio: document.getElementById('profile-bio').value.trim(),
                native_lang: document.getElementById('profile-native-lang').value,
                learning_lang: document.getElementById('profile-learning-lang').value,
                avatar_color: activeColor ? activeColor.dataset.color : undefined,
            });
            UI.updateAuthState();
            UI.closeProfileModal();
            showNotification('Profile updated! ✅');
        } catch (err) { UI.showFormError('profile-error', err.message); }
    });

    // Create room
    document.getElementById('hero-create-room')?.addEventListener('click', () => UI.openCreateRoomModal());
    document.getElementById('btn-create-room')?.addEventListener('click', () => UI.openCreateRoomModal());
    document.getElementById('create-room-close')?.addEventListener('click', () => UI.closeCreateRoomModal());
    document.getElementById('create-room-cancel')?.addEventListener('click', () => UI.closeCreateRoomModal());

    document.getElementById('room-lang-select')?.addEventListener('change', e => {
        if (e.target.value) { CreateRoom.addLang(e.target.value); e.target.value = ''; }
    });

    document.getElementById('create-room-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const name = document.getElementById('room-name-input').value.trim();
        const access = document.querySelector('input[name="room-access"]:checked')?.value || 'open';
        const level = document.getElementById('room-level-input').value;
        const maxP = document.getElementById('room-max-input').value;
        const langs = CreateRoom.selectedLangs;
        if (!name) { UI.showFormError('create-room-error', 'Room name is required'); return; }
        if (langs.length === 0) { UI.showFormError('create-room-error', 'Select at least one language'); return; }
        try {
            const room = await API.createRoom({
                name, language: langs[0], flag: LANGUAGES.find(l => l.id === langs[0])?.flag || '🌐',
                type: 'both', access, level, max_participants: parseInt(maxP),
                description: langs.length > 1 ? `${langs.map(l => LANGUAGES.find(x => x.id === l)?.name || l).join(' + ')} practice room` : ''
            });
            UI.closeCreateRoomModal();
            CreateRoom.reset();
            await Rooms.loadRooms();
            Rooms.openRoom(room.id);
            showNotification('Room created! 🎉');
        } catch (err) { UI.showFormError('create-room-error', err.message); }
    });

    // Language filter expand/collapse
    document.getElementById('lang-filter-toggle')?.addEventListener('click', () => {
        const bar = document.getElementById('lang-filter-bar');
        bar?.classList.toggle('expanded');
        const span = document.querySelector('#lang-filter-toggle span');
        if (span) span.textContent = bar.classList.contains('expanded') ? 'Collapse' : 'Expand';
    });

    // Room view
    document.getElementById('rv-close-btn')?.addEventListener('click', () => exitRoomView());
    document.getElementById('rv-leave-btn')?.addEventListener('click', () => exitRoomView());

    // Room chat
    const chatInput = document.getElementById('rv-chat-input');
    chatInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const content = chatInput.value.trim();
            if (content && SocketClient.currentRoomId) {
                SocketClient.sendMessage(SocketClient.currentRoomId, content);
                chatInput.value = '';
            }
        }
    });
    document.getElementById('rv-chat-send')?.addEventListener('click', () => {
        const content = chatInput?.value.trim();
        if (content && SocketClient.currentRoomId) {
            SocketClient.sendMessage(SocketClient.currentRoomId, content);
            chatInput.value = '';
        }
    });

    // Room chat tabs
    document.querySelectorAll('.rv-tab').forEach(tab => {
        tab.addEventListener('click', () => RoomView.switchTab(tab.dataset.tab));
    });

    // Voice toolbar
    document.getElementById('rv-mic-btn')?.addEventListener('click', () => {
        if (!Voice.isInVoice) {
            Voice.joinVoice(SocketClient.currentRoomId);
        } else {
            Voice.toggleMute();
        }
    });

    // Emoji picker
    const pickerElem = document.getElementById('emoji-picker-element');
    if (pickerElem) {
        pickerElem.addEventListener('emoji-click', event => {
            const emoji = event.detail.unicode;
            RoomView.sendReaction(emoji);
            if (SocketClient.currentRoomId) {
                SocketClient.sendMessage(SocketClient.currentRoomId, emoji);
            }
            document.getElementById('emoji-picker-popup').classList.add('hidden');
        });
    }
    document.getElementById('rv-btn-emoji')?.addEventListener('click', () => {
        document.getElementById('emoji-picker-popup')?.classList.toggle('hidden');
    });

    // Hand raise
    document.getElementById('rv-hand-btn')?.addEventListener('click', () => {
        const btn = document.getElementById('rv-hand-btn');
        btn.classList.toggle('active');
        if (btn.classList.contains('active')) {
            RoomView.sendReaction('✋');
            if (SocketClient.currentRoomId) SocketClient.sendMessage(SocketClient.currentRoomId, '✋ raised hand');
            showNotification('Hand raised! ✋');
        } else {
            showNotification('Hand lowered');
        }
    });

    // Camera toggle
    document.getElementById('rv-cam-btn')?.addEventListener('click', () => {
        Voice.toggleCamera();
    });

    // Screen share
    document.getElementById('rv-screen-btn')?.addEventListener('click', () => {
        Voice.toggleScreenShare();
    });

    // Share room
    document.getElementById('rv-share-btn')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(window.location.href).then(() => showNotification('Room link copied! 📋'));
    });

    // Hero explore button
    document.getElementById('hero-explore')?.addEventListener('click', () => {
        document.getElementById('rooms')?.scrollIntoView({ behavior: 'smooth' });
    });

    // Search
    document.getElementById('nav-search')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) { Rooms.currentFilter = 'all'; Rooms.renderRooms(); return; }
        const grid = document.getElementById('rooms-grid');
        if (!grid) return;
        const filtered = Rooms.allRooms.filter(r => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q) || r.language.includes(q));
        // Temporarily override
        const origAll = Rooms.allRooms;
        Rooms.allRooms = filtered;
        Rooms.currentFilter = 'all';
        Rooms.renderRooms();
        Rooms.allRooms = origAll;
    });

    // Modal overlays close on click outside
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });

    // Close popups on click outside
    document.addEventListener('click', e => {
        const emojiPicker = document.getElementById('emoji-picker-popup');
        const emojiBtn = document.getElementById('rv-btn-emoji');
        if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.add('hidden');
        }

        const gifPopup = document.getElementById('gif-picker-popup');
        const gifBtn = document.getElementById('rv-btn-gif');
        if (gifPopup && !gifPopup.contains(e.target) && gifBtn && !gifBtn.contains(e.target)) {
            gifPopup.classList.add('hidden');
        }

        const stickerPopup = document.getElementById('sticker-picker-popup');
        const stickerBtn = document.getElementById('rv-btn-sticker');
        if (stickerPopup && !stickerPopup.contains(e.target) && stickerBtn && !stickerBtn.contains(e.target)) {
            stickerPopup.classList.add('hidden');
        }
    });

    // GIF Picker setup
    const gifBtn = document.getElementById('rv-btn-gif');
    const gifPopup = document.getElementById('gif-picker-popup');
    const gifSearch = document.getElementById('gif-search');
    const gifGrid = document.getElementById('gif-grid');
    let gifTimeout;

    const fetchGifs = async (query = '') => {
        if (!gifGrid) return;
        gifGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">Loading...</p>';
        try {
            const res = await fetch(`/api/gifs?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.error) {
                gifGrid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--rose);padding:1rem;">${data.error}</p>`;
                return;
            }
            if (!data.results || data.results.length === 0) {
                 gifGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">No GIFs found</p>';
                 return;
            }
            gifGrid.innerHTML = data.results.map(gif => `
                <img src="${gif.media_formats.tinygif.url}" data-full="${gif.media_formats.gif.url}" alt="GIF">
            `).join('');
            
            gifGrid.querySelectorAll('img').forEach(img => {
                img.addEventListener('click', () => {
                    const fullUrl = img.dataset.full;
                    if (SocketClient.currentRoomId) {
                        SocketClient.sendMessage(SocketClient.currentRoomId, `[GIF] ${fullUrl}`);
                    }
                    if (gifPopup) gifPopup.classList.add('hidden');
                });
            });
        } catch (e) {
            gifGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--rose);padding:1rem;">Error loading GIFs</p>';
        }
    };

    if (gifBtn) {
        gifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (gifPopup) {
                gifPopup.classList.toggle('hidden');
                if (!gifPopup.classList.contains('hidden') && gifGrid && gifGrid.innerHTML === '') {
                    fetchGifs(''); 
                }
            }
        });
    }

    if (gifSearch) {
        gifSearch.addEventListener('input', (e) => {
            clearTimeout(gifTimeout);
            gifTimeout = setTimeout(() => {
                fetchGifs(e.target.value);
            }, 500);
        });
    }

    // Sticker Picker setup
    const stickerBtn = document.getElementById('rv-btn-sticker');
    const stickerPopup = document.getElementById('sticker-picker-popup');
    const stickerSearch = document.getElementById('sticker-search');
    const stickerGrid = document.getElementById('sticker-grid');
    let stickerTimeout;

    const fetchStickers = async (query = '') => {
        if (!stickerGrid) return;
        stickerGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">Loading...</p>';
        try {
            const res = await fetch(`/api/stickers?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.error) {
                stickerGrid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--rose);padding:1rem;">${data.error}</p>`;
                return;
            }
            if (!data.results || data.results.length === 0) {
                 stickerGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">No Stickers found</p>';
                 return;
            }
            stickerGrid.innerHTML = data.results.map(gif => `
                <img src="${gif.media_formats.tinygif.url}" data-full="${gif.media_formats.gif.url}" alt="Sticker" style="width:100%; aspect-ratio:1; object-fit:contain; border-radius:8px; cursor:pointer;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
            `).join('');
            
            stickerGrid.querySelectorAll('img').forEach(img => {
                img.addEventListener('click', () => {
                    const fullUrl = img.dataset.full;
                    if (SocketClient.currentRoomId) {
                        SocketClient.sendMessage(SocketClient.currentRoomId, `[STICKER] ${fullUrl}`);
                    }
                    if (stickerPopup) stickerPopup.classList.add('hidden');
                });
            });
        } catch (e) {
            stickerGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--rose);padding:1rem;">Error loading Stickers</p>';
        }
    };

    if (stickerBtn) {
        stickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (stickerPopup) {
                stickerPopup.classList.toggle('hidden');
                if (!stickerPopup.classList.contains('hidden') && stickerGrid && stickerGrid.innerHTML === '') {
                    fetchStickers(''); 
                }
            }
        });
    }

    if (stickerSearch) {
        stickerSearch.addEventListener('input', (e) => {
            clearTimeout(stickerTimeout);
            stickerTimeout = setTimeout(() => {
                fetchStickers(e.target.value);
            }, 500);
        });
    }

    // Image Upload setup
    const uploadBtn = document.getElementById('rv-btn-upload');
    const fileInput = document.getElementById('rv-file-input');

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert('Only image files are supported');
                return;
            }

            try {
                const formData = new FormData();
                formData.append('image', file);
                
                const originalText = uploadBtn.innerHTML;
                uploadBtn.innerHTML = '⏳';
                uploadBtn.style.opacity = '0.5';
                uploadBtn.disabled = true;

                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await res.json();
                
                uploadBtn.innerHTML = originalText;
                uploadBtn.style.opacity = '1';
                uploadBtn.disabled = false;
                
                if (data.error) {
                    alert(data.error);
                    return;
                }
                
                if (SocketClient.currentRoomId && data.url) {
                    SocketClient.sendMessage(SocketClient.currentRoomId, `[IMAGE] ${data.url}`);
                }
            } catch (err) {
                console.error(err);
                alert('Uploading failed.');
                uploadBtn.innerHTML = '📷';
                uploadBtn.style.opacity = '1';
                uploadBtn.disabled = false;
            } finally {
                fileInput.value = '';
            }
        });
    }

    // Apps Interactivity
    document.querySelectorAll('.rv-app-card').forEach(card => {
        card.addEventListener('click', () => {
            const appType = card.dataset.app;
            
            // Handle Main Stage Apps
            if (appType === 'chess') {
                document.getElementById('rv-participants-grid').classList.add('minimized');
                document.getElementById('ms-app-container').classList.remove('hidden');
                document.getElementById('ms-app-chess').classList.remove('hidden');
                
                if (window.ChessApp) window.ChessApp.init();
                return; 
            }

            // Handle Right Panel Apps (YouTube, etc)
            document.getElementById('rv-apps-grid').classList.add('hidden');
            document.querySelector('.rv-apps-header').classList.add('hidden');
            document.getElementById('rv-app-view').classList.remove('hidden');
            
            document.querySelectorAll('#rv-app-view-content > div').forEach(div => div.classList.add('hidden'));

            if (appType === 'youtube') {
                document.getElementById('rv-app-view-title').textContent = 'YouTube';
                document.getElementById('yt-app-container').classList.remove('hidden');
                if (window.YouTubeApp) window.YouTubeApp.init(); 
            } else if (appType === 'pomodoro') {
                document.getElementById('rv-app-view-title').textContent = 'Focus Timer';
                document.getElementById('pomo-app-container').classList.remove('hidden');
                if (window.PomodoroApp) window.PomodoroApp.init();
            } else if (appType === 'todo') {
                document.getElementById('rv-app-view-title').textContent = 'Shared Tasks';
                document.getElementById('todo-app-container').classList.remove('hidden');
                if (window.TodoApp) window.TodoApp.init();
            } else {
                document.getElementById('rv-app-view-title').textContent = appType.charAt(0).toUpperCase() + appType.slice(1);
                let placeholderObj = document.getElementById('placeholder-app-msg');
                if(!placeholderObj){
                    placeholderObj = document.createElement('div');
                    placeholderObj.id = 'placeholder-app-msg';
                    placeholderObj.style.cssText = 'padding:2rem;text-align:center;color:var(--text-muted);';
                    document.getElementById('rv-app-view-content').appendChild(placeholderObj);
                }
                placeholderObj.innerHTML = `<h3>${appType} is coming soon!</h3>`;
                placeholderObj.classList.remove('hidden');
            }
        });
    });

    document.getElementById('rv-app-back')?.addEventListener('click', () => {
        document.getElementById('rv-app-view').classList.add('hidden');
        document.getElementById('rv-apps-grid').classList.remove('hidden');
        document.querySelector('.rv-apps-header').classList.remove('hidden');
        
        // Ensure yt is stopped when backing out
        if (!document.getElementById('yt-player-wrapper').classList.contains('hidden')) {
            YouTubeApp.stopVideo(true);
        }
    });

    document.getElementById('ms-app-close')?.addEventListener('click', () => {
        document.getElementById('ms-app-container').classList.add('hidden');
        document.getElementById('rv-participants-grid').classList.remove('minimized');
        document.getElementById('ms-app-chess')?.classList.add('hidden');
        if (window.ChessApp) window.ChessApp.cleanup();
    });

    // Navbar scroll effect
    window.addEventListener('scroll', () => {
        document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 20);
    });

    // Theme Toggle Logic
    const themeBtn = document.getElementById('nav-theme-btn');
    const iconLight = document.getElementById('theme-icon-light');
    const iconDark = document.getElementById('theme-icon-dark');
    
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const updateThemeIcon = () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const pickerElement = document.getElementById('emoji-picker-element');
        if (currentTheme === 'light') {
            if (iconLight) iconLight.classList.add('hidden');
            if (iconDark) iconDark.classList.remove('hidden');
            if (pickerElement) pickerElement.classList.replace('dark', 'light');
        } else {
            if (iconLight) iconLight.classList.remove('hidden');
            if (iconDark) iconDark.classList.add('hidden');
            if (pickerElement) pickerElement.classList.replace('light', 'dark');
        }
    };
    
    updateThemeIcon(); 
    
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon();
        });
    }

    // ---- Social Panel ----
    document.getElementById('nav-social-btn')?.addEventListener('click', () => Social.open());
    document.getElementById('social-panel-close')?.addEventListener('click', () => Social.close());
    document.getElementById('social-panel-overlay')?.addEventListener('click', () => Social.close());

    document.querySelectorAll('.sp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            Social.switchTab(tab.dataset.sptab);
            if (tab.dataset.sptab === 'dms') {
                // collapse DM conversation if open and refresh list
                DM.closeConversation();
                Social.renderDMList();
            }
        });
    });

    // ---- DM Panel ----
    document.getElementById('sp-dm-back')?.addEventListener('click', () => DM.closeConversation());
    document.getElementById('sp-dm-send')?.addEventListener('click', () => DM.send());
    document.getElementById('sp-dm-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') DM.send();
        else {
            if (DM.activePartnerId && SocketClient.socket) {
                SocketClient.socket.emit('dm-typing', { receiverId: DM.activePartnerId });
            }
        }
    });

    // ---- User Profile Modal ----
    document.getElementById('user-profile-modal-close')?.addEventListener('click', () => {
        document.getElementById('user-profile-modal').classList.remove('open');
    });
    document.getElementById('user-profile-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('user-profile-modal')) {
            document.getElementById('user-profile-modal').classList.remove('open');
        }
    });

    // ---- Context Menu (Moderation) ----
    document.getElementById('ctx-view-profile')?.addEventListener('click', () => {
        const t = Moderation._currentTarget;
        if (t) UserProfile.open(t.userId);
        Moderation.hideContextMenu();
    });
    document.getElementById('ctx-dm')?.addEventListener('click', () => {
        const t = Moderation._currentTarget;
        if (t) { Social.open(); Social.switchTab('dms'); DM.openConversation(t.userId, t.username); }
        Moderation.hideContextMenu();
    });
    document.getElementById('ctx-make-coowner')?.addEventListener('click', () => {
        Moderation.assignRole('co-owner');
        Moderation.hideContextMenu();
    });
    document.getElementById('ctx-remove-coowner')?.addEventListener('click', () => {
        Moderation.assignRole('guest');
        Moderation.hideContextMenu();
    });
    document.getElementById('ctx-mute')?.addEventListener('click', () => {
        Moderation.mute();
        Moderation.hideContextMenu();
    });
    document.getElementById('ctx-kick')?.addEventListener('click', () => {
        Moderation.kick();
        Moderation.hideContextMenu();
    });

    // Dismiss context menu on outside click
    document.addEventListener('click', e => {
        const menu = document.getElementById('ctx-menu');
        if (menu && !menu.contains(e.target)) Moderation.hideContextMenu();
    });
}

// ===============================================
// CHESS APP SINGLETON
// ===============================================
const ChessApp = {
    initialized: false,
    
    init() {
        document.getElementById('chess-lobby-ui').style.display = 'flex';
        document.getElementById('chess-game-ui').style.display = 'none';
        
        if (this.initialized) return;
        this.initialized = true;

        document.getElementById('chess-btn-computer').addEventListener('click', () => {
            this.playComputer();
        });

        document.getElementById('chess-btn-challenge').addEventListener('click', () => {
            this.createChallenge();
        });

        if (SocketClient.socket) {
            SocketClient.socket.on('yt-sync', (data) => {
                this.renderAvailableTable(data);
            });
        }
    },

    playComputer() {
        // Lichess explicitly blocks /setup/ai via X-Frame-Options: DENY.
        // We pop this open securely in a new tab. Voice remains active in current tab!
        window.open("https://lichess.org/setup/ai", "_blank");
    },

    async createChallenge() {
        try {
            const btn = document.getElementById('chess-btn-challenge');
            btn.innerHTML = 'Creating...';
            btn.disabled = true;

            const formdata = new FormData(); // empty post
            const res = await fetch('https://lichess.org/api/challenge/open', {
                method: 'POST'
            });
            const data = await res.json();
            
            btn.innerHTML = 'Challenge';
            btn.disabled = false;

            if (data.challenge && data.challenge.url) {
                if (SocketClient.currentRoomId) {
                    SocketClient.socket.emit('yt-sync', {
                        roomId: SocketClient.currentRoomId, 
                        action: 'chess-table', 
                        payload: {
                            url: data.challenge.url,
                            user: Auth.user?.username || 'Guest'
                        }
                    });
                }
                this.joinTable(data.challenge.url);
            }
        } catch(e) {
            console.error("Lichess err", e);
            alert("Failed to reach Lichess server. Checking CORS requirements...");
            document.getElementById('chess-btn-challenge').innerHTML = 'Challenge';
            document.getElementById('chess-btn-challenge').disabled = false;
        }
    },

    joinTable(url) {
        document.getElementById('chess-lobby-ui').style.display = 'none';
        document.getElementById('chess-game-ui').style.display = 'flex';
        document.getElementById('chess-iframe').src = url;
    },

    renderAvailableTable(data) {
        if(data.action !== 'chess-table') return;
        
        const container = document.getElementById('chess-available-players');
        
        if (container.innerHTML.includes('Waiting for others')) {
            container.innerHTML = '';
        }
        
        const row = document.createElement('div');
        row.style.cssText = 'padding: 1rem 1.5rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background: var(--bg-primary);';
        row.innerHTML = `
            <span style="font-weight:600; color:var(--text-primary); font-size: 0.95rem;">${data.payload.user}</span>
            <button class="btn btn-sm" style="background:rgba(34,197,94,0.1); color:var(--emerald); border:1px solid var(--emerald); padding:0.4rem 0.8rem; border-radius:4px; font-weight:700; cursor:pointer;">Join Match</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
            this.joinTable(data.payload.url);
            row.remove();
        });
        
        container.appendChild(row);
    },

    cleanup() {
        document.getElementById('chess-iframe').src = "";
    }
};

window.ChessApp = ChessApp;

// ===============================================
// YOUTUBE APP SINGLETON
// ===============================================
const YouTubeApp = {
    player: null,
    ready: false,
    currentVideoId: null,
    initialized: false,
    
    init() {
        if (this.initialized) return;
        this.initialized = true;

        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            // Insert Before explicitly into head
            document.head.appendChild(tag);
            
            window.onYouTubeIframeAPIReady = () => {
                YouTubeApp.ready = true;
            };
        } else {
            this.ready = true;
        }

        const searchBtn = document.getElementById('yt-search-btn');
        const searchInput = document.getElementById('yt-search-input');
        
        searchBtn?.addEventListener('click', () => this.handleSearch(searchInput.value));
        searchInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch(searchInput.value);
        });

        document.querySelectorAll('.yt-mix-card').forEach(card => {
            card.addEventListener('click', () => {
                this.loadVideo(card.dataset.video, true);
            });
        });

        document.getElementById('yt-close-player')?.addEventListener('click', () => {
            this.stopVideo(true);
        });

        document.getElementById('yt-control-play')?.addEventListener('click', () => {
            this.togglePlay(true);
        });
        
        // Setup internal Socket Client for Sync (assumes SocketClient.socket exists)
        if (SocketClient.socket) {
            SocketClient.socket.on('yt-sync', (data) => {
                if (data.action === 'load') this.loadVideoLocal(data.payload);
                if (data.action === 'play') this.playLocal(data.payload);
                if (data.action === 'pause') this.pauseLocal(data.payload);
                if (data.action === 'stop') this.stopLocal();
            });
        }
    },

    extractVideoId(input) {
        const urlMatch = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})/);
        return urlMatch ? urlMatch[1] : null;
    },

    async handleSearch(query) {
        if (!query.trim()) return;
        
        const videoId = this.extractVideoId(query);
        if (videoId) {
            this.loadVideo(videoId, true);
            return;
        }

        try {
            const searchBtn = document.getElementById('yt-search-btn');
            const originalText = searchBtn.textContent;
            searchBtn.textContent = '...';
            const res = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            searchBtn.textContent = originalText;
            
            if (data.results && data.results.length > 0) {
                this.renderResults(data.results);
            } else {
                alert('No results or invalid API key.');
            }
        } catch (e) {
            alert('Failed to search');
        }
    },

    renderResults(results) {
        const area = document.getElementById('yt-results-area');
        area.innerHTML = results.map(item => `
            <div class="yt-mix-card" onclick="window.YouTubeApp.loadVideo('${item.id}', true)">
                <div class="yt-mix-thumb">
                    <img src="${item.thumbnail}" alt="${item.title}">
                </div>
                <div class="yt-mix-info">
                    <div class="yt-mix-tag" style="background:rgba(99,102,241,0.1); color:var(--accent);">SEARCH RESULT</div>
                    <strong>${item.title}</strong>
                    <span>${item.channel}</span>
                </div>
            </div>
        `).join('');
    },

    loadVideo(videoId, sync = false) {
        if (sync && SocketClient.currentRoomId) {
            SocketClient.socket.emit('yt-sync', { roomId: SocketClient.currentRoomId, action: 'load', payload: videoId });
        }
        this.loadVideoLocal(videoId);
    },

    loadVideoLocal(videoId) {
        document.getElementById('yt-results-area').classList.add('hidden');
        document.getElementById('yt-search-area').classList.add('hidden');
        document.getElementById('yt-player-wrapper').classList.remove('hidden');

        if (!this.player && window.YT && window.YT.Player) {
            this.player = new window.YT.Player('yt-player', {
                height: '100%',
                width: '100%',
                videoId: videoId,
                playerVars: { 'autoplay': 1, 'controls': 1 },
                events: { }
            });
            this.currentVideoId = videoId;
        } else if (this.player) {
            this.player.loadVideoById(videoId);
            this.currentVideoId = videoId;
        }
    },

    togglePlay(sync = false) {
        if (!this.player) return;
        const state = this.player.getPlayerState();
        const time = this.player.getCurrentTime();
        if (state === window.YT.PlayerState.PLAYING) {
            this.player.pauseVideo();
            if (sync && SocketClient.currentRoomId) {
                SocketClient.socket.emit('yt-sync', { roomId: SocketClient.currentRoomId, action: 'pause', payload: time });
            }
        } else {
            this.player.playVideo();
            if (sync && SocketClient.currentRoomId) {
                SocketClient.socket.emit('yt-sync', { roomId: SocketClient.currentRoomId, action: 'play', payload: time });
            }
        }
    },

    playLocal(time) {
        if (this.player && this.player.playVideo) {
            if (Math.abs(this.player.getCurrentTime() - time) > 2) {
                this.player.seekTo(time);
            }
            this.player.playVideo();
        }
    },
    
    pauseLocal(time) {
        if (this.player && this.player.pauseVideo) {
            this.player.pauseVideo();
            this.player.seekTo(time);
        }
    },

    stopVideo(sync = false) {
        if (sync && SocketClient.currentRoomId) {
            SocketClient.socket.emit('yt-sync', { roomId: SocketClient.currentRoomId, action: 'stop' });
        }
        this.stopLocal();
    },

    stopLocal() {
        document.getElementById('yt-player-wrapper').classList.add('hidden');
        document.getElementById('yt-results-area').classList.remove('hidden');
        document.getElementById('yt-search-area').classList.remove('hidden');
        if (this.player) {
             this.player.stopVideo();
        }
    }
};

window.YouTubeApp = YouTubeApp;

// ===============================================
// POMODORO APP SINGLETON
// ===============================================
const PomodoroApp = {
    initialized: false,
    interval: null,
    endTime: null,
    isRunning: false,
    mode: 'pomodoro', 
    currentMinutes: 25,
    secondsLeft: 25 * 60,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.display = document.getElementById('pomo-display');
        this.startBtn = document.getElementById('pomo-btn-start');
        this.resetBtn = document.getElementById('pomo-btn-reset');
        this.minPill = document.getElementById('pomo-minutes-display');
        this.syncBadge = document.getElementById('pomo-sync-badge');
        this.syncUser = document.getElementById('pomo-sync-user');

        document.querySelectorAll('.pomo-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if(this.isRunning) return; 
                document.querySelectorAll('.pomo-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                this.mode = btn.dataset.mode;
                this.currentMinutes = parseInt(btn.dataset.min);
                this.secondsLeft = this.currentMinutes * 60;
                this.minPill.textContent = this.currentMinutes;
                this.updateDisplay(this.secondsLeft);
            });
        });

        this.startBtn.addEventListener('click', () => {
            if (this.isRunning) {
                this.stopLocal();
                this.broadcastSync('stop', 0);
            } else {
                const finishTime = Date.now() + (this.secondsLeft * 1000);
                this.startLocal(finishTime);
                this.broadcastSync('start', finishTime);
            }
        });

        this.resetBtn.addEventListener('click', () => {
            this.resetLocal();
            this.broadcastSync('reset', 0);
        });

        document.getElementById('pomo-close')?.addEventListener('click', () => {
             document.getElementById('rv-app-back').click();
        });

        if (SocketClient.socket) {
            SocketClient.socket.on('yt-sync', (data) => {
                if (data.action === 'pomo') {
                    this.handleSync(data.payload);
                }
            });
        }
        
        this.updateDisplay(this.secondsLeft);
    },

    broadcastSync(command, endTimestamp) {
        if (!SocketClient.currentRoomId) return;
         SocketClient.socket.emit('yt-sync', {
            roomId: SocketClient.currentRoomId, 
            action: 'pomo', 
            payload: {
                command: command,
                endTime: endTimestamp,
                mode: this.mode,
                user: Auth.user?.username || 'Guest',
                task: document.getElementById('pomo-task').value
            }
        });
    },

    handleSync(payload) {
        this.syncBadge.style.display = 'block';
        this.syncUser.textContent = payload.user;

        if(payload.task) document.getElementById('pomo-task').value = payload.task;

        if (payload.command === 'start') {
            if(this.mode !== payload.mode && !this.isRunning) {
               document.querySelector(`.pomo-mode-btn[data-mode="${payload.mode}"]`)?.click();
            }
            this.startLocal(payload.endTime);
        } else if (payload.command === 'stop') {
            this.stopLocal();
        } else if (payload.command === 'reset') {
            this.resetLocal();
        }
    },

    startLocal(endTimestamp) {
        this.endTime = endTimestamp;
        this.isRunning = true;
        
        this.startBtn.classList.add('running');
        this.startBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pause</span>`;
        
        if (this.interval) clearInterval(this.interval);
        
        this.interval = setInterval(() => {
            const now = Date.now();
            let remain = Math.max(0, Math.floor((this.endTime - now) / 1000));
            this.secondsLeft = remain;
            this.updateDisplay(remain);
            
            if (remain <= 0) {
                this.stopLocal();
            }
        }, 1000);
    },

    stopLocal() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        
        this.startBtn.classList.remove('running');
        this.startBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Start</span>`;
    },

    resetLocal() {
        this.stopLocal();
        this.secondsLeft = this.currentMinutes * 60;
        this.updateDisplay(this.secondsLeft);
    },

    updateDisplay(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        if (this.display) {
            this.display.textContent = `${m}:${s}`;
        }
    }
};

window.PomodoroApp = PomodoroApp;

// ===============================================
// TODO APP SINGLETON
// ===============================================
const TodoApp = {
    initialized: false,
    items: [],

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.input = document.getElementById('todo-input');
        this.addBtn = document.getElementById('todo-btn-add');
        this.listEl = document.getElementById('todo-list-container');
        this.emptyState = document.getElementById('todo-empty-state');

        this.addBtn.addEventListener('click', () => this.handleAdd());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleAdd();
        });

        if (SocketClient.socket) {
            SocketClient.socket.on('yt-sync', (data) => {
                if (data.action === 'todo') {
                    this.handleSync(data.payload);
                }
            });
        }
    },

    handleAdd() {
        const text = this.input.value.trim();
        if (!text) return;
        
        const username = Auth.user?.username || 'Guest';
        const newItem = {
            id: 'todo_' + Date.now() + '_' + Math.random().toString(36).substr(2,9),
            text: text,
            done: false,
            author: username
        };
        
        this.input.value = '';
        this.items.push(newItem);
        this.render();
        this.broadcastSync('add', newItem);
    },

    toggleItem(id) {
        const item = this.items.find(i => i.id === id);
        if (item) {
            item.done = !item.done;
            this.render();
            // We dispatch the FULL item state to ensure syncing is perfectly resilient
            this.broadcastSync('toggle', { id: id, done: item.done });
        }
    },

    deleteItem(id) {
        const item = this.items.find(i => i.id === id);
        if (item) {
            // PROTECTED LOGIC: Secondary authorization verification before emit
            const username = Auth.user?.username || 'Guest';
            const isOwner = Auth.user?.id === SocketClient.currentRoomData?.owner_id;
            
            if (item.author === username || isOwner) {
                this.items = this.items.filter(i => i.id !== id);
                this.render();
                this.broadcastSync('delete', { id });
            } else {
                alert("Protected Action: You don't have permission to delete this task.");
            }
        }
    },

    render() {
        if (this.items.length === 0) {
            this.emptyState.style.display = 'block';
            Array.from(this.listEl.children).forEach(child => {
                if (child.id !== 'todo-empty-state') child.remove();
            });
            return;
        }

        this.emptyState.style.display = 'none';
        
        // Unmount old
        Array.from(this.listEl.children).forEach(child => {
            if (child.id !== 'todo-empty-state') child.remove();
        });

        const username = Auth.user?.username || 'Guest';
        const isOwner = Auth.user?.id === SocketClient.currentRoomData?.owner_id;

        this.items.forEach(item => {
            const row = document.createElement('div');
            row.className = `todo-item ${item.done ? 'done' : ''}`;
            
            // PROTECTED LOGIC: Only the author or room owner can see the delete button
            const canDelete = (item.author === username || isOwner);
            
            row.innerHTML = `
                <div class="todo-checkbox" onclick="window.TodoApp.toggleItem('${item.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="todo-content">
                    <div class="todo-text">${item.text.replace(/</g, "&lt;")}</div>
                    <div class="todo-author">Added by ${item.author}</div>
                </div>
                ${canDelete ? `
                <button class="todo-btn-delete" title="Delete Task" onclick="window.TodoApp.deleteItem('${item.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
                ` : '<div style="width:32px;"></div>'}
            `;
            
            this.listEl.appendChild(row);
        });
    },

    broadcastSync(command, data) {
        if (!SocketClient.currentRoomId) return;
        SocketClient.socket.emit('yt-sync', {
            roomId: SocketClient.currentRoomId, 
            action: 'todo', 
            payload: { command, data }
        });
    },

    handleSync(payload) {
        const { command, data } = payload;
        
        if (command === 'add') {
            if (!this.items.find(i => i.id === data.id)) {
                this.items.push(data);
                this.render();
            }
        } 
        else if (command === 'toggle') {
            const item = this.items.find(i => i.id === data.id);
            if (item) {
                item.done = data.done;
                this.render();
            }
        }
        else if (command === 'delete') {
            this.items = this.items.filter(i => i.id !== data.id);
            this.render();
        }
    }
};

window.TodoApp = TodoApp;

// ==========================================
// SOCIAL MODULE
// ==========================================
const Social = {
    data: { followers: [], following: [], blocks: [] },
    loaded: false,

    async load() {
        if (!Auth.isLoggedIn()) return;
        try {
            const res = await fetch('/api/social/me', { headers: Auth.getHeaders() });
            const d = await res.json();
            if (res.ok) {
                this.data = d;
                this.loaded = true;
                this.renderPanel();
            }
        } catch (e) { console.error('Social load error', e); }
    },

    async follow(userId) {
        const res = await fetch(`/api/social/follow/${userId}`, { method: 'POST', headers: Auth.getHeaders() });
        if (res.ok) { await this.load(); return true; }
        return false;
    },

    async unfollow(userId) {
        const res = await fetch(`/api/social/follow/${userId}`, { method: 'DELETE', headers: Auth.getHeaders() });
        if (res.ok) { await this.load(); return true; }
        return false;
    },

    async block(userId) {
        const res = await fetch(`/api/social/block/${userId}`, { method: 'POST', headers: Auth.getHeaders() });
        if (res.ok) { await this.load(); return true; }
        return false;
    },

    async unblock(userId) {
        const res = await fetch(`/api/social/block/${userId}`, { method: 'DELETE', headers: Auth.getHeaders() });
        if (res.ok) { await this.load(); return true; }
        return false;
    },

    isFollowing(userId) { return this.data.following?.some(u => u.id === userId) ?? false; },
    isBlocked(userId) { return this.data.blocks?.includes(userId) ?? false; },

    open() {
        const panel = document.getElementById('social-panel');
        const overlay = document.getElementById('social-panel-overlay');
        if (!panel) return;
        panel.classList.remove('hidden');
        requestAnimationFrame(() => panel.classList.add('open'));
        overlay.classList.remove('hidden');
        if (!this.loaded) this.load();
        else this.renderPanel();
    },

    close() {
        const panel = document.getElementById('social-panel');
        const overlay = document.getElementById('social-panel-overlay');
        panel?.classList.remove('open');
        overlay?.classList.add('hidden');
        setTimeout(() => panel?.classList.add('hidden'), 280);
    },

    switchTab(tabName) {
        document.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t.dataset.sptab === tabName));
        document.querySelectorAll('.sp-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`sp-content-${tabName}`)?.classList.add('active');
    },

    renderPanel() {
        const followers = this.data.followers || [];
        const following = this.data.following || [];
        const followingIds = new Set(following.map(u => u.id));
        const followerIds = new Set(followers.map(u => u.id));
        const friends = followers.filter(u => followingIds.has(u.id));

        this._renderUserList('sp-followers-list', followers, 'No followers yet');
        this._renderUserList('sp-following-list', following, 'Not following anyone');
        this._renderUserList('sp-friends-list', friends, 'No mutual follows yet');
    },

    _renderUserList(containerId, users, emptyMsg) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (users.length === 0) { el.innerHTML = `<div class="sp-empty">${emptyMsg}</div>`; return; }
        el.innerHTML = users.map(u => {
            const avatarC = u.avatar_url
                ? `<img src="${escapeHtml(u.avatar_url)}" referrerpolicy="no-referrer" alt="${escapeHtml(u.username)}">`
                : (u.username || 'U')[0].toUpperCase();
            return `<div class="sp-user-item" data-uid="${u.id}">
                <div class="sp-user-avatar" style="background:${u.avatar_color||'#6366f1'}">${avatarC}</div>
                <div class="sp-user-info"><div class="sp-user-name">${escapeHtml(u.username)}</div></div>
                <div class="sp-user-actions">
                    <button class="sp-action-btn" title="Message" data-uid="${u.id}" data-action="dm">💬</button>
                    <button class="sp-action-btn" title="Profile" data-uid="${u.id}" data-action="profile">👤</button>
                </div>
            </div>`;
        }).join('');
        el.querySelectorAll('.sp-action-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const uid = parseInt(btn.dataset.uid);
                if (btn.dataset.action === 'dm') { DM.openConversation(uid, users.find(u => u.id === uid)?.username || ''); Social.switchTab('dms'); }
                else if (btn.dataset.action === 'profile') UserProfile.open(uid);
            });
        });
        el.querySelectorAll('.sp-user-item').forEach(item => {
            item.addEventListener('click', e => {
                if (e.target.closest('.sp-action-btn')) return;
                UserProfile.open(parseInt(item.dataset.uid));
            });
        });
    },

    async renderDMList() {
        const el = document.getElementById('sp-dm-list');
        if (!el) return;
        try {
            const res = await fetch('/api/social/dms', { headers: Auth.getHeaders() });
            const data = await res.json();
            const convos = data.conversations || [];
            if (convos.length === 0) { el.innerHTML = '<div class="sp-empty">No conversations yet</div>'; return; }
            el.innerHTML = convos.map(c => {
                const avatarC = c.partner_avatar_url
                    ? `<img src="${escapeHtml(c.partner_avatar_url)}" referrerpolicy="no-referrer" alt="${escapeHtml(c.partner_username)}">`
                    : (c.partner_username || 'U')[0].toUpperCase();
                const preview = c.last_sender_id === Auth.user?.id ? `You: ${c.last_message}` : c.last_message;
                return `<div class="sp-dm-item" data-uid="${c.partner_id}" data-username="${escapeHtml(c.partner_username)}">
                    <div class="sp-user-avatar" style="background:${c.partner_avatar_color||'#6366f1'}">${avatarC}</div>
                    <div class="sp-dm-info">
                        <div class="sp-dm-name">${escapeHtml(c.partner_username)}</div>
                        <div class="sp-dm-preview">${escapeHtml((preview||'').substring(0,50))}</div>
                    </div>
                </div>`;
            }).join('');
            el.querySelectorAll('.sp-dm-item').forEach(item => {
                item.addEventListener('click', () => DM.openConversation(parseInt(item.dataset.uid), item.dataset.username));
            });
        } catch(e) { el.innerHTML = '<div class="sp-empty">Error loading DMs</div>'; }
    }
};

// ==========================================
// DIRECT MESSAGES MODULE
// ==========================================
const DM = {
    activePartnerId: null,
    activePartnerName: null,
    typingTimer: null,

    openConversation(userId, username) {
        this.activePartnerId = userId;
        this.activePartnerName = username;

        document.getElementById('sp-dm-partner-name').textContent = username;
        document.getElementById('sp-dm-convo').classList.remove('hidden');
        document.querySelectorAll('.sp-content').forEach(c => c.classList.remove('active'));

        this.loadHistory(userId);
        document.getElementById('sp-dm-input')?.focus();
    },

    closeConversation() {
        this.activePartnerId = null;
        document.getElementById('sp-dm-convo').classList.add('hidden');
        Social.switchTab('dms');
    },

    async loadHistory(userId) {
        const container = document.getElementById('sp-dm-messages');
        if (!container) return;
        container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:1rem;">Loading…</div>';
        try {
            const res = await fetch(`/api/social/dms/${userId}`, { headers: Auth.getHeaders() });
            if (!res.ok) { container.innerHTML = '<div style="color:var(--rose);text-align:center;padding:1rem;">Blocked or unavailable</div>'; return; }
            const data = await res.json();
            container.innerHTML = '';
            (data.messages || []).forEach(m => this._appendMsg(m.content, m.sender_id === Auth.user?.id));
            container.scrollTop = container.scrollHeight;
        } catch(e) { container.innerHTML = '<div style="color:var(--rose);text-align:center;padding:1rem;">Error loading messages</div>'; }
    },

    send() {
        const input = document.getElementById('sp-dm-input');
        const content = input?.value.trim();
        if (!content || !this.activePartnerId || !SocketClient.socket) return;
        SocketClient.socket.emit('dm-send', { receiverId: this.activePartnerId, content });
        input.value = '';
    },

    onSent(payload) {
        if (payload.from !== Auth.user?.id) return; // Only echo for current user
        this._appendMsg(payload.content, true);
    },

    onIncoming(payload) {
        if (this.activePartnerId === payload.from) {
            this._appendMsg(payload.content, false);
        } else {
            // Notification for DM from other conversations
            showNotification(`💬 ${payload.fromUsername}: ${payload.content.substring(0, 40)}`);
        }
    },

    showTyping(fromUsername) {
        if (!this.activePartnerId) return;
        const el = document.getElementById('sp-dm-typing');
        if (!el) return;
        el.textContent = `${fromUsername} is typing…`;
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => { el.textContent = ''; }, 2500);
    },

    _appendMsg(content, isMine) {
        const container = document.getElementById('sp-dm-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = `dm-msg ${isMine ? 'mine' : 'theirs'}`;
        div.textContent = content;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
};

// ==========================================
// USER PROFILE MODAL MODULE
// ==========================================
const UserProfile = {
    currentUserId: null,
    currentData: null,

    async open(userId) {
        if (!Auth.isLoggedIn()) { UI.openLoginModal(); return; }
        this.currentUserId = userId;
        document.getElementById('user-profile-modal').classList.add('open');

        // Reset state
        document.getElementById('up-avatar').textContent = '…';
        document.getElementById('up-username').textContent = 'Loading…';
        document.getElementById('up-bio').textContent = '';
        document.getElementById('up-langs').textContent = '';
        document.getElementById('up-followers-count').textContent = '0';
        document.getElementById('up-following-count').textContent = '0';

        try {
            const res = await fetch(`/api/social/users/${userId}`, { headers: Auth.getHeaders() });
            const data = await res.json();
            if (!res.ok) { showNotification('⚠️ Could not load profile'); return; }
            this.currentData = data;
            this._render(data);
        } catch(e) { showNotification('⚠️ Error loading profile'); }
    },

    _render({ user, isFollowing, isBlocked, isBlockedBy }) {
        const avatarEl = document.getElementById('up-avatar');
        if (user.avatar_url) {
            avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" referrerpolicy="no-referrer" alt="${escapeHtml(user.username)}">`;
        } else {
            avatarEl.textContent = (user.username || 'U')[0].toUpperCase();
            avatarEl.style.backgroundColor = user.avatar_color || '#6366f1';
        }
        document.getElementById('up-username').textContent = user.username;
        document.getElementById('up-bio').textContent = user.bio || '';
        const langs = [user.native_lang, user.learning_lang].filter(Boolean);
        document.getElementById('up-langs').textContent = langs.length ? '🌐 ' + langs.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(' → ') : '';
        document.getElementById('up-followers-count').textContent = user.followers_count || 0;
        document.getElementById('up-following-count').textContent = user.following_count || 0;

        const followBtn = document.getElementById('up-follow-btn');
        const blockBtn = document.getElementById('up-block-btn');
        const dmBtn = document.getElementById('up-dm-btn');
        const actionsEl = document.getElementById('up-actions');
        const blockedMsg = document.getElementById('up-blocked-msg');

        if (isBlockedBy) {
            actionsEl.classList.add('hidden');
            blockedMsg.classList.remove('hidden');
            blockedMsg.textContent = 'This user has blocked you.';
            return;
        }

        actionsEl.classList.remove('hidden');
        blockedMsg.classList.add('hidden');

        followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
        followBtn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
        blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';

        // Re-attach handlers (clone to remove old listeners)
        const newFollowBtn = followBtn.cloneNode(true);
        const newBlockBtn = blockBtn.cloneNode(true);
        const newDmBtn = dmBtn.cloneNode(true);
        followBtn.replaceWith(newFollowBtn);
        blockBtn.replaceWith(newBlockBtn);
        dmBtn.replaceWith(newDmBtn);

        newFollowBtn.addEventListener('click', async () => {
            if (isFollowing) { await Social.unfollow(user.id); }
            else { await Social.follow(user.id); }
            this.open(user.id); // Refresh profile
        });
        newBlockBtn.addEventListener('click', async () => {
            if (isBlocked) { await Social.unblock(user.id); }
            else { if (confirm(`Block ${user.username}?`)) await Social.block(user.id); }
            this.open(user.id);
        });
        newDmBtn.addEventListener('click', () => {
            document.getElementById('user-profile-modal').classList.remove('open');
            Social.open();
            Social.switchTab('dms');
            DM.openConversation(user.id, user.username);
        });
    }
};

// ==========================================
// MODERATION MODULE
// ==========================================
const Moderation = {
    _currentTarget: null,

    getMyRole() {
        if (!Auth.user || !RoomView.room) return 'guest';
        // Use == to handle potential string/int type differences between JWT and DB
        if (String(RoomView.room.creator_id) === String(Auth.user.id)) return 'owner';
        const me = RoomView.participants.find(p => String(p.id) === String(Auth.user.id));
        return me?.room_role || 'guest';
    },

    canActOn(targetRole) {
        const myRole = this.getMyRole();
        if (myRole === 'owner') return targetRole !== 'owner';
        if (myRole === 'co-owner') return targetRole === 'guest';
        return false;
    },

    showContextMenu(x, y, userId, username, targetRole) {
        const myRole = this.getMyRole();
        const canAct = this.canActOn(targetRole);
        this._currentTarget = { userId, username, targetRole };

        const menu = document.getElementById('ctx-menu');

        // Show/hide mod actions based on role permission
        document.getElementById('ctx-make-coowner').style.display = (myRole === 'owner' && targetRole === 'guest') ? 'block' : 'none';
        document.getElementById('ctx-remove-coowner').style.display = (myRole === 'owner' && targetRole === 'co-owner') ? 'block' : 'none';
        document.getElementById('ctx-mute').style.display = canAct ? 'block' : 'none';
        document.getElementById('ctx-kick').style.display = canAct ? 'block' : 'none';

        // Position
        menu.classList.remove('hidden');
        const vw = window.innerWidth, vh = window.innerHeight;
        const mw = 175, mh = menu.offsetHeight || 200;
        menu.style.left = Math.min(x, vw - mw - 8) + 'px';
        menu.style.top = Math.min(y, vh - mh - 8) + 'px';
    },

    hideContextMenu() {
        document.getElementById('ctx-menu')?.classList.add('hidden');
    },

    async assignRole(role) {
        const t = this._currentTarget;
        if (!t || !RoomView.room) return;
        try {
            const res = await fetch(`/api/rooms/${RoomView.room.id}/roles`, {
                method: 'POST',
                headers: Auth.getHeaders(),
                body: JSON.stringify({ userId: t.userId, role })
            });
            if (res.ok) {
                SocketClient.socket.emit('room-role-update', {
                    roomId: RoomView.room.id,
                    targetUserId: t.userId,
                    role
                });
                showNotification(`✅ ${t.username} is now ${role}`);
            } else {
                const d = await res.json();
                showNotification(`⚠️ ${d.error}`);
            }
        } catch(e) { showNotification('⚠️ Failed to assign role'); }
    },

    kick(targetSocketId) {
        const t = this._currentTarget;
        if (!t || !RoomView.room || !SocketClient.socket) return;
        if (!this.canActOn(t.targetRole)) { showNotification('⛔ No permission'); return; }
        // Find target socket ID from voice peers
        let foundSocketId = targetSocketId;
        if (!foundSocketId) {
            for (const [sid, peer] of Voice.peers) {
                const p = RoomView.participants.find(p => p.username === peer.username);
                if (p && p.id === t.userId) { foundSocketId = sid; break; }
            }
        }
        SocketClient.socket.emit('room-kick', {
            roomId: RoomView.room.id,
            targetSocketId: foundSocketId,
            targetUserId: t.userId
        });
        showNotification(`🚫 Kicked ${t.username}`);
    },

    mute() {
        const t = this._currentTarget;
        if (!t || !RoomView.room || !SocketClient.socket) return;
        if (!this.canActOn(t.targetRole)) { showNotification('⛔ No permission'); return; }
        SocketClient.socket.emit('room-mute', {
            roomId: RoomView.room.id,
            targetUserId: t.userId,
            muted: true
        });
        showNotification(`🔇 Muted ${t.username}`);
    }
};

// ==========================================
// INIT
// ==========================================
async function init() {
    observeElements();

    // Verify auth
    if (Auth.token) {
        const valid = await Auth.verifyToken();
        if (!valid) Auth.clear();
    }
    UI.updateAuthState();

    // Load rooms
    await Rooms.loadRooms();

    setupEventListeners();

    // FAQ Accordion logic
    document.querySelectorAll('.faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.parentElement;
            const isOpen = item.classList.contains('open');
            document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
            if (!isOpen) item.classList.add('open');
        });
    });

    // Google Auth
    setTimeout(initGoogleAuth, 1000);

    // Populate language selects with flags
    populateLanguageSelects();

    // Refresh rooms periodically
    setInterval(() => Rooms.loadRooms(), 30000);
}

document.addEventListener('DOMContentLoaded', init);
