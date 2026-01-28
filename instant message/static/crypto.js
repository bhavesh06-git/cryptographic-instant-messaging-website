class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.dbName = "SecureChatDB";
    }

    async init() {
        // Load or Create Key from IndexedDB
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore("keys");
            req.onsuccess = async (e) => {
                this.db = e.target.result;
                this.keyPair = await this.loadKeyPair();
                if (!this.keyPair) {
                    this.keyPair = await window.crypto.subtle.generateKey(
                        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
                    );
                    await this.saveKeyPair(this.keyPair);
                }
                resolve();
            };
        });
    }

    async saveKeyPair(kp) {
        const tx = this.db.transaction(["keys"], "readwrite");
        tx.objectStore("keys").put(kp, "identity");
    }

    async loadKeyPair() {
        return new Promise(resolve => {
            const tx = this.db.transaction(["keys"], "readonly");
            const req = tx.objectStore("keys").get("identity");
            req.onsuccess = e => resolve(e.target.result);
        });
    }

    async exportPublicKey() {
        const exp = await window.crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
        return JSON.stringify(exp);
    }

    async importPeerKey(jwkStr) {
        return await window.crypto.subtle.importKey(
            "jwk", JSON.parse(jwkStr), { name: "ECDH", namedCurve: "P-256" }, true, []
        );
    }

    async deriveSharedSecret(peerKey) {
        return await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: peerKey },
            this.keyPair.privateKey,
            { name: "AES-GCM", length: 256 },
            true, ["encrypt", "decrypt"]
        );
    }

    async encrypt(data, key) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
        
        // Convert to Base64 components
        return {
            cipher: this.buffToBase64(encrypted),
            iv: this.buffToBase64(iv)
        };
    }

    async decrypt(cipherB64, ivB64, key) {
        const cipher = this.base64ToBuff(cipherB64);
        const iv = this.base64ToBuff(ivB64);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipher);
        return decrypted; // Returns ArrayBuffer
    }

    // --- FILE KEYS ---
    async generateFileKey() {
        return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    }
    
    async exportKeyRaw(key) { return await window.crypto.subtle.exportKey("jwk", key); }
    async importKeyRaw(jwk) { return await window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }

    // Helpers
    buffToBase64(buff) { return btoa(String.fromCharCode(...new Uint8Array(buff))); }
    base64ToBuff(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
}