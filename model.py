import pickle
import cv2
import mediapipe as mp
import numpy as np
import warnings
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# Suppress warnings related to deprecated functions
warnings.filterwarnings("ignore", category=UserWarning, message="SymbolDatabase.GetPrototype() is deprecated")

app = FastAPI()

# Load the trained model
model_dict = pickle.load(open('./model.p', 'rb'))
model = model_dict['model']

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
hands = mp_hands.Hands(static_image_mode=True, min_detection_confidence=0.3)

# Dictionary mapping class indices to labels
labels_dict = {
    0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 7: 'H', 8: 'I', 9: 'J',
    10: 'K', 11: 'L', 12: 'M', 13: 'N', 14: 'O', 15: 'P', 16: 'Q', 17: 'R', 18: 'S',
    19: 'T', 20: 'U', 21: 'V', 22: 'W', 23: 'X', 24: 'Y', 25: 'Z', 26: 'Thank You', 27: 'I love You', 
    28: 'No', 29: 'Good Night', 30: 'Be Safe', 31: 'Are', 32: 'Peace', 33: 'Goodbye', 
    34: 'Hello', 35: 'Take Care', 36: 'All The Best', 37: 'Yes', 38: 'Sorry', 39: 'Please',
    40: 'HackFest', 41: 'Welcome', 42: 'We', 43: 'When', 44: 'To', 45: 'LeetRankers', 
    46: 'In', 47: 'Am'
}

async def process_video(websocket: WebSocket):
    print("Accepting WebSocket connection...")
    await websocket.accept()
    print("WebSocket connection accepted.")
    
    previous_character = None 
    consecutive_predictions = []
    consecutive_threshold = 4  # Filter out single-frame prediction noise
    no_hand_counter = 0
    no_hand_threshold = 8      # Reset to 'None' if no hand is detected for 8 frames

    try:
        while True:
            # Receive binary frame from client
            data = await websocket.receive_bytes()
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None:
                continue

            H, W, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(frame_rgb)

            predicted_character = None

            if results.multi_hand_landmarks:
                no_hand_counter = 0  # Reset the no-hand counter since a hand is present
                
                # Draw hand landmarks on the frame
                for hand_landmarks in results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        frame, hand_landmarks,
                        mp_hands.HAND_CONNECTIONS,
                        mp_drawing_styles.get_default_hand_landmarks_style(),
                        mp_drawing_styles.get_default_hand_connections_style()
                    )

                # Process only the first hand to guarantee exactly 42 features
                hand_landmarks = results.multi_hand_landmarks[0]
                data_aux = []
                x_ = []
                y_ = []

                for i in range(len(hand_landmarks.landmark)):
                    x = hand_landmarks.landmark[i].x
                    y = hand_landmarks.landmark[i].y
                    x_.append(x)
                    y_.append(y)

                for i in range(len(hand_landmarks.landmark)):
                    x = hand_landmarks.landmark[i].x
                    y = hand_landmarks.landmark[i].y
                    data_aux.append(x - min(x_))
                    data_aux.append(y - min(y_))

                # Check that features match expected 42
                if len(data_aux) == 42:
                    # Make prediction
                    prediction = model.predict([np.asarray(data_aux)])
                    raw_prediction = labels_dict[int(prediction[0])]
                    
                    # Append prediction to history buffer
                    consecutive_predictions.append(raw_prediction)
                    if len(consecutive_predictions) > consecutive_threshold:
                        consecutive_predictions.pop(0)
                        
                    # Confirm prediction only if all items in window are identical
                    if len(consecutive_predictions) == consecutive_threshold and len(set(consecutive_predictions)) == 1:
                        predicted_character = raw_prediction

                        # Define bounding box
                        x1 = int(min(x_) * W) - 10
                        y1 = int(min(y_) * H) - 10
                        x2 = int(max(x_) * W) + 10
                        y2 = int(max(y_) * H) + 10

                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        text_position = (10, H - 20)
                        cv2.putText(frame, predicted_character, text_position, cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2, cv2.LINE_AA)
            else:
                # No hand detected: increment the counter
                no_hand_counter += 1
                if no_hand_counter >= no_hand_threshold:
                    consecutive_predictions.clear()
                    predicted_character = "None"
                    no_hand_counter = 0

            # Convert frame back to JPEG and send it to the client
            ret, jpeg = cv2.imencode(".jpg", frame)
            if ret:
                frame_bytes = jpeg.tobytes()
                await websocket.send_bytes(frame_bytes)

            # Send predicted character as text if changed
            if predicted_character and predicted_character != previous_character:
                print("Predicted Hand Sign:", predicted_character)
                await websocket.send_text(predicted_character)
                previous_character = predicted_character

    except WebSocketDisconnect:
        print("WebSocket disconnected.")
    except Exception as e:
        print(f"Error in WebSocket process: {e}")

# WebSocket endpoint for video feed
@app.websocket("/video-feed")
async def video_feed(websocket: WebSocket):
    await process_video(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("model:app", host="127.0.0.1", port=8000, log_level="info")



