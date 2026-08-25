\# SYSTEM ARCHITECTURE



\## FOLDER STRUCTURE

/client

&#x20; ├── index.html (Login/Register UI)

&#x20; ├── chat.html (Main Chat UI)

&#x20; ├── css/style.css

&#x20; ├── js/auth.js

&#x20; ├── js/chat.js (Socket.io \& CryptoJS logic)

/server

&#x20; ├── server.js (Entry point)

&#x20; ├── db.js (SQLite connection)

&#x20; ├── socket.js (WebSocket handlers)



\## MANUAL E2EE DATA FLOW

1\. \*\*Sender:\*\* Types plaintext -> Enters Secret Key -> Clicks 'Encrypt' -> JS uses CryptoJS (AES-256) to create ciphertext -> Clicks 'Send'.

2\. \*\*Transport:\*\* Ciphertext sent via Socket.io -> Server stores ciphertext in DB -> Server broadcasts ciphertext to Receiver.

3\. \*\*Receiver:\*\* UI displays raw ciphertext -> User clicks 'Decrypt' -> Enters Secret Key -> JS uses CryptoJS to decrypt -> UI displays plaintext.

