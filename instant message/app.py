import time
import uuid
import io
import datetime
from flask import Flask, request, jsonify, render_template, send_file
from flask_socketio import SocketIO, emit, join_room
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret_key_demo'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///secure_chat.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- DATABASE ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    public_key = db.Column(db.Text, nullable=False)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(80), nullable=False)
    recipient = db.Column(db.String(80), nullable=False)
    ciphertext = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)

VOLATILE_FILE_STORE = {}

@app.route('/')
def index():
    return render_template('index.html')

# --- ADMIN GRAPH ROUTE ---
@app.route('/admin')
def admin_panel():
    # Fetch data for the graph
    users = User.query.all()
    messages = Message.query.all()
    
    # Format data for Vis.js (Nodes and Edges)
    nodes = [{'id': u.username, 'label': u.username, 'group': 'users'} for u in users]
    edges = [{'from': m.sender, 'to': m.recipient} for m in messages]
    
    return render_template('admin.html', nodes=nodes, edges=edges, raw_msgs=messages)

# --- AUTH & KEYS ---
@app.route('/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"error": "Username taken"}), 400
    new_user = User(username=data['username'], password_hash=generate_password_hash(data['password']), public_key=data['public_key'])
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"message": "Registered"}), 201

@app.route('/get_key/<username>', methods=['GET'])
def get_key(username):
    user = User.query.filter_by(username=username).first()
    return jsonify({"public_key": user.public_key}) if user else (jsonify({"error": "Not found"}), 404)

# --- BLIND FILE UPLOAD ---
@app.route('/upload_blind', methods=['POST'])
def upload_blind():
    file = request.files['file']
    file_id = str(uuid.uuid4())
    VOLATILE_FILE_STORE[file_id] = {'data': file.read(), 'timestamp': time.time()}
    return jsonify({"file_id": file_id}), 201

@app.route('/download_blind/<file_id>', methods=['GET'])
def download_blind(file_id):
    entry = VOLATILE_FILE_STORE.get(file_id)
    return send_file(io.BytesIO(entry['data']), mimetype='application/octet-stream') if entry else (jsonify({"error": "Expired"}), 404)

# --- REAL-TIME EVENTS ---
@socketio.on('join')
def on_join(data):
    join_room(data['username'])

@socketio.on('private_message')
def handle_message(data):
    # Log for Admin
    db.session.add(Message(sender=data['sender'], recipient=data['recipient'], ciphertext=data['ciphertext']))
    db.session.commit()
    emit('incoming_message', data, room=data['recipient'])

# --- WEBRTC SIGNALING (VIDEO CALLS) ---
@socketio.on('call-user')
def call_user(data):
    emit('call-made', {'offer': data['offer'], 'socket': request.sid, 'sender': data['sender']}, room=data['to'])

@socketio.on('make-answer')
def make_answer(data):
    emit('answer-made', {'answer': data['answer'], 'socket': request.sid}, room=data['to'])

@socketio.on('ice-candidate')
def ice_candidate(data):
    emit('ice-candidate-relayed', {'candidate': data['candidate'], 'sender': data['sender']}, room=data['to'])

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, port=5000)
    
    from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Temporary storage for signals (In real life, use Redis or a Database)
signals = {} 

@app.route('/')
def index():
    return render_template('index.html')

# 1. Upload a signal (Offer or Answer) for a specific user
@app.route('/signal/<user_id>', methods=['POST'])
def upload_signal(user_id):
    data = request.json
    signals[user_id] = data
    return jsonify({"status": "Signal received", "type": data.get('type')})

# 2. Check if there is a signal waiting for me
@app.route('/check_signal/<user_id>', methods=['GET'])
def check_signal(user_id):
    if user_id in signals:
        data = signals.pop(user_id) # Get and delete signal
        return jsonify(data)
    return jsonify({"status": "none"})

if __name__ == '__main__':
    # Important: WebRTC works best on localhost or HTTPS. 
    # It often fails on HTTP over a network due to browser security.
    app.run(debug=True, port=5000)