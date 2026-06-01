//const AgoraRTC_N4202 = require("./AgoraRTC_N-4.20.2");

//const AgoraRTC_N4202 = require("./AgoraRTC_N-4.20.2");

const APP_Id= "f1fbb42b040f48f2bcb00317a702ad0a";


let uid = sessionStorage.getItem("uid");
if (!uid) {
  uid = String(Math.floor(Math.random() * 10000));
  sessionStorage.setItem("uid", uid);
}

let token = null;
let client;

let rtmClient;
let channel;

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let roomId = urlParams.get('room');

if (!roomId) {
  roomId = "main";
}

let displayName= sessionStorage.getItem("display_name")

if(!displayName){
    window.location="lobby.html"
}

let localTracks = [];
let remoteUsers = {};
let localScreenTracks;
let sharingScreen=false;

let joinRoomInit = async()=>{
    // Try initializing Agora RTM
    let rtmInitialized = false;
    try {
        if (typeof AgoraRTM !== 'undefined') {
            rtmClient = await AgoraRTM.createInstance(APP_Id)
            await rtmClient.login({uid,token})
            await rtmClient.addOrUpdateLocalUserAttributes({"name":displayName})

            channel = await rtmClient.createChannel(roomId)
            await channel.join()

            channel.on("MemberJoined",handleMemberJoined)
            channel.on("MemberLeft",handleMemberLeft)
            channel.on("ChannelMessage",handleChannelMessage)
            rtmInitialized = true;
        } else {
            console.warn("AgoraRTM SDK is not loaded. Standing by in local call mode.");
        }
    } catch(err) {
        console.warn("Agora RTM failed to login. Running chat and roster in offline fallback mode.", err);
    }

    // Try initializing Agora RTC
    let rtcInitialized = false;
    try {
        client = AgoraRTC.createClient({mode:'rtc',codec:'vp8'})
        await client.join(APP_Id,roomId,token,uid)

        client.on("user-published",handleUserPublished)
        client.on("user-left",handleUserLeft)
        rtcInitialized = true;
    } catch(err) {
        console.error("Agora RTC join failed. Activating native webcam fallback system...", err);
    }

    // Load participants safely
    try {
        await getMembers()
    } catch(membersErr) {
        console.error("Error loading members list:", membersErr);
    }

    // Load stream safely
    if (rtcInitialized) {
        try {
            await joinStream()
        } catch(err) {
            console.error("Agora joinStream failed. Activating native webcam fallback...", err);
            await startLocalVideoFallback()
        }
    } else {
        await startLocalVideoFallback()
    }
}

let startLocalVideoFallback = async () => {
    console.log("Starting native HTML5 video fallback...");
    try {
        let stream;
        try {
            // First attempt with both camera and microphone
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: true
            });
            console.log("Successfully started native camera with audio.");
        } catch (audioErr) {
            console.warn("Could not start camera with audio (possibly no microphone or permission denied). Attempting camera only...", audioErr);
            // Fallback to camera only
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
            console.log("Successfully started native camera only.");
        }

        let player = `<div class="video__container" id="user-container-${uid}">
            <video id="fallback-local-video" autoplay playsinline muted style="width: 100%; height: 100%; border-radius: 5px; background: black; object-fit: cover;"></video>
        </div>`;

        const streamsContainer = document.getElementById("streams__container");
        if (streamsContainer) {
            streamsContainer.insertAdjacentHTML("beforeend", player);
            document.getElementById(`user-container-${uid}`).addEventListener("click", expandvideoFrame);
            
            const videoEl = document.getElementById("fallback-local-video");
            if (videoEl) {
                videoEl.srcObject = stream;
            }
        }
    } catch (e) {
        console.error("Unable to obtain native video stream:", e);
        alert("Camera could not be opened. Please verify that:\n1. You are accessing the page via http://localhost or http://127.0.0.1 (not file://)\n2. You have granted camera permissions in your browser settings.\n3. Your webcam is connected and not in use by another application.");
    }
}

let joinStream=async()=>{
    try {
        localTracks = await AgoraRTC.createMicrophoneAndCameraTracks({},{encoderConfig:{width:{min:640,ideal:1920,max:1920},
            height:{min:480,ideal:1080,max:1080}
        }})
    } catch(audioCameraErr) {
        console.warn("Agora failed to create microphone and camera tracks. Trying camera only...", audioCameraErr);
        try {
            // Attempt to create camera track only
            let cameraTrack = await AgoraRTC.createCameraVideoTrack({encoderConfig:{width:{min:640,ideal:1920,max:1920},
                height:{min:480,ideal:1080,max:1080}
            }});
            localTracks = [null, cameraTrack]; // index 0 is microphone, index 1 is camera
        } catch(cameraOnlyErr) {
            console.error("Agora failed to create camera track only:", cameraOnlyErr);
            throw cameraOnlyErr; // rethrow to trigger the native getUserMedia fallback!
        }
    }

    let player =`<div class="video__container" id="user-container-${uid}">
    <div class="video-player" id="user-${uid}"></div>
</div>`

    document.getElementById("streams__container").insertAdjacentHTML("beforeend",player)
    document.getElementById(`user-container-${uid}`).addEventListener("click",expandvideoFrame)
    
    if (localTracks[1]) {
        localTracks[1].play(`user-${uid}`)
    }
    
    // Publish tracks that exist
    let tracksToPublish = [];
    if (localTracks[0]) tracksToPublish.push(localTracks[0]);
    if (localTracks[1]) tracksToPublish.push(localTracks[1]);
    if (tracksToPublish.length > 0) {
        await client.publish(tracksToPublish)
    }
}

let handleUserPublished = async(user,mediaType)=>{
    remoteUsers[user.uid]=user
    
    await client.subscribe(user,mediaType)
    
    let player = document.getElementById(`user-container-${user.uid}`)
    if (player===null){
        player=`<div class="video__container" id="user-container-${user.uid}">
        <div class="video-player" id="user-${user.uid}"></div>
        </div>`
        
        document.getElementById("streams__container").insertAdjacentHTML("beforeend",player)
        document.getElementById(`user-container-${user.uid}`).addEventListener("click",expandvideoFrame)
    }
    if(displayFrame.style.display){
        let videoFrame=document.getElementById(`user-container-${user.uid}`)
        videoFrame.style.height = '100px'
        videoFrame.style.width = '100px'
    }

    if(mediaType==="video"){
        user.videoTrack.play(`user-${user.uid}`)
    }
    if(mediaType==="audio"){
        user.audioTrack.play()
    }
}

let handleUserLeft = async (user) => {
    delete remoteUsers[user.uid]
    let item = document.getElementById(`user-container-${user.uid}`)
    if(item){
        item.remove()
    }

    if(userIdInDisplayFrame === `user-container-${user.uid}`){
        displayFrame.style.display = null
        
        let videoFrames = document.getElementsByClassName('video__container')

        for(let i = 0; videoFrames.length > i; i++){
            videoFrames[i].style.height = '300px'
            videoFrames[i].style.width = '300px'
        }
    }
}

let toggleMic= async(e)=>{
    let button =e.currentTarget

    // Support fallback native microphone muting
    const fallbackVideo = document.getElementById("fallback-local-video");
    if (fallbackVideo && fallbackVideo.srcObject) {
        let audioTracks = fallbackVideo.srcObject.getAudioTracks();
        if (audioTracks.length > 0) {
            let active = audioTracks[0].enabled;
            audioTracks[0].enabled = !active;
            if (audioTracks[0].enabled) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
            return;
        }
    }

    if (localTracks[0]) {
        if(localTracks[0].muted){
            await localTracks[0].setMuted(false)
            button.classList.add('active')
        }
        else{
            await localTracks[0].setMuted(true)
            button.classList.remove('active')
        }
    }
}

let toggleCamera= async(e)=>{
    let button =e.currentTarget

    // Support fallback native camera stream muting
    const fallbackVideo = document.getElementById("fallback-local-video");
    if (fallbackVideo && fallbackVideo.srcObject) {
        let videoTracks = fallbackVideo.srcObject.getVideoTracks();
        if (videoTracks.length > 0) {
            let active = videoTracks[0].enabled;
            videoTracks[0].enabled = !active;
            if (videoTracks[0].enabled) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
            return;
        }
    }

    if (localTracks[1]) {
        if(localTracks[1].muted){
            await localTracks[1].setMuted(false)
            button.classList.add('active')
        }
        else{
            await localTracks[1].setMuted(true)
            button.classList.remove('active')
        }
    }
}


let toggleScreen=async(e)=>{
    let screenButton=e.currentTarget
    let cameraButton=document.getElementById("camera-btn")

    if(!sharingScreen){
        sharingScreen=true
        screenButton.classList.add("active")

        localScreenTracks = await AgoraRTC.createScreenVideoTrack()

        document.getElementById(`user-container-${uid}`).remove()

        let player=`<div class="video__container" id="user-container-${uid}">
        <div class="video-player" id="user-${uid}"></div>
        </div>`

        document.getElementById("stream__container").insertAdjacentHTML("beforeend",player)
        document.getElementById(`user-container-${uid}`).addEventListener("click",expandvideoFrame)

        userIdDisplayFrame=`user-container-${uid}`
        localScreenTracks.play(`user-${uid}`)
        
        let videoFrames=document.getElementsByClassName("video__container")
        for(let i=0;videoFrames.length>i;i++){
            if(videoFrames[i].id!=userIdDisplayFrame){
                videoFrames[i].style.height='100px';
                videoFrames[i].style.width='100px';
            }
        }
    }
    else{
       sharingScreen=false
        document.getElementById(`user-container-${uid}`).remove()
    }
}
let leaveStream = async (e) => {
    if (e) e.preventDefault()

    // Stop fallback stream tracks if active
    const fallbackVideo = document.getElementById("fallback-local-video");
    if (fallbackVideo && fallbackVideo.srcObject) {
        let tracks = fallbackVideo.srcObject.getTracks();
        tracks.forEach(track => track.stop());
    }
    
    for(let i = 0; localTracks.length > i; i++){
        localTracks[i].stop()
        localTracks[i].close()
    }

    if (client) {
        try {
            await client.unpublish([localTracks[0], localTracks[1]])
        } catch(err) {}
    }

    if(localScreenTracks && client){
        try {
            await client.unpublish([localScreenTracks])
        } catch(err) {}
    }

    const item = document.getElementById(`user-container-${uid}`);
    if (item) item.remove()

    if (channel) {
        try {
            channel.sendMessage({text:JSON.stringify({'type':'user_left', 'uid':uid})})
        } catch(err) {}
    }
    
    try {
        await leaveChannel()
    } catch(err) {}

    window.location=`lobby.html`
}


document.getElementById("camera-btn").addEventListener("click",toggleCamera)
document.getElementById("mic-btn").addEventListener("click",toggleMic)
document.getElementById("screen-btn").addEventListener("click",toggleScreen)
document.getElementById('leave-btn').addEventListener('click', leaveStream)

joinRoomInit()
