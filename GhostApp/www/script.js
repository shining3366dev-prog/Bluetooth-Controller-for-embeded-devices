/* =======================================================
   REALISTIC BOOT SEQUENCE
   ======================================================= */
const termWindow = document.getElementById('term-window');
const bootSequence = [
    "Linux ghost-node 5.10.0-kali3-amd64 #1 SMP Debian 5.10.13-1kali1 x86_64",
    "Loading initial ramdisk...",
    "INIT: version 2.96 booting",
    "[ OK ] Mounted Configuration File System.",
    "[ OK ] Started D-Bus System Message Bus.",
    "[ OK ] Started Secure Bluetooth Daemon.",
    "Mounting /var/log...",
    "Starting Hardware Tunneling Proxy...",
    "[ OK ] Reached target Tactical Interface.",
    " ",
    "Last login: Fri Mar 06 21:02:18 2026 from 192.168.1.44",
    "Type 'help' for commands."
];

let bootIndex = 0;
function runBoot() {
    if(bootIndex < bootSequence.length) {
        printTerminal(bootSequence[bootIndex], "#a0a0a0");
        bootIndex++;
        setTimeout(runBoot, Math.random() * 150 + 50);
    } else {
        document.getElementById('input-wrap').style.display = "flex";
        document.getElementById('cmd-input').focus();
    }
}
window.onload = runBoot;

/* =======================================================
   UI & KEYPAD LOGIC
   ======================================================= */
let currentInput = "";
let localTimer = null;
let timeLeft = 0.0;
let isArmed = false;

function addNumber(num) { if (currentInput.length < 8) { currentInput += num; updateDisplay(); } }
function clearDisplay() { currentInput = ""; updateDisplay(); }
function updateDisplay() { document.getElementById('display').innerHTML = currentInput === "" ? "_" : currentInput; }

function printTerminal(text, color = "#00ff00") {
    const line = document.createElement('div');
    line.className = 'terminal-line'; line.style.color = color; line.innerText = text;
    termWindow.appendChild(line); termWindow.scrollTop = termWindow.scrollHeight;
}

document.getElementById('cmd-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        const rawCmd = this.value.trim();
        const args = rawCmd.split(" ");
        const cmd = args[0].toLowerCase();
        
        printTerminal(`root@ghost-node:~# ${rawCmd}`, "#ffffff");
        this.value = "";

        switch (cmd) {
            case "help":
                printTerminal("  connect       - Establish link to C-4 hardware");
                printTerminal("  auth <pass>   - Transmit authorization code to hardware");
                printTerminal("  time          - Display simulated time remaining");
                printTerminal("  clear         - Wipe terminal output");
                break;
            case "connect": connectBLE(); break;
            case "auth":
                if(args.length > 1) transmitPayload(args[1]);
                else printTerminal("bash: auth: missing operand", "#ff3333");
                break;
            case "time":
                if (!bleDevice || !bleDevice.gatt.connected) printTerminal("[-] ERROR: Target offline.", "#ff3333");
                else if (isArmed) printTerminal(`[!] TIME REMAINING: ${timeLeft.toFixed(1)}s`, "#ffff00");
                else printTerminal("[*] System is currently DISARMED.");
                break;
            case "clear": termWindow.innerHTML = ""; break;
            case "": break;
            default: printTerminal("bash: " + cmd + ": command not found", "#ff3333");
        }
    }
});

/* =======================================================
   BLUETOOTH & AUTO-SYNC LOGIC
   ======================================================= */
let bleDevice; let bleCharacteristic;

async function connectBLE() {
    if (!navigator.bluetooth) { printTerminal("[-] ERROR: Web Bluetooth not supported.", "#ff3333"); return; }
    try {
        printTerminal("[*] Scanning for target hardware 'C-4_GHOST_882'...");
        bleDevice = await navigator.bluetooth.requestDevice({ filters: [{ name: 'C-4_GHOST_882' }], optionalServices: [0x00FF] });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            printTerminal("[-] WARNING: Hardware connection lost.", "#ff3333");
            document.getElementById('sys-status').innerText = "OFFLINE";
            document.getElementById('sys-status').className = "data-val status-disconnected";
            document.getElementById('btn-connect').innerText = "[ RECONNECT UPLINK ]";
            stopLocalTimer();
        });

        const bleServer = await bleDevice.gatt.connect();
        const bleService = await bleServer.getPrimaryService(0x00FF);
        bleCharacteristic = await bleService.getCharacteristic(0xFF01);

        await bleCharacteristic.startNotifications();
        bleCharacteristic.addEventListener('characteristicvaluechanged', handleDataPacket);

        printTerminal("[+] Secure tunnel established.", "#55ff55");
        document.getElementById('sys-status').innerText = "ONLINE";
        document.getElementById('sys-status').className = "data-val status-connected";
        document.getElementById('btn-connect').innerText = "[ UPLINK ACTIVE ]";
        
        await bleCharacteristic.writeValue(new TextEncoder('utf-8').encode("SYNC"));
    } catch (error) { printTerminal("[-] CONNECTION FAILED: " + error, "#ff3333"); }
}

function handleDataPacket(event) {
    const msg = new TextDecoder('utf-8').decode(event.target.value);
    const parts = msg.split(':');
    const packetType = parts[0];

    switch(packetType) {
        case "TICK":
            // SILENT SYNC: Corrects JS drift without printing to terminal!
            timeLeft = parseFloat(parts[1]);
            document.getElementById('sys-timer').innerText = timeLeft.toFixed(1) + "s";
            break;
            
        case "SYNC":
            isArmed = (parts[1] === "1"); timeLeft = parseFloat(parts[2]);
            printTerminal(`[+] SYNC OK. Max Time: ${parts[3]}s. Armed: ${isArmed}`, "#55ff55");
            if (isArmed && timeLeft > 0) startLocalTimer(); else stopLocalTimer();
            break;
            
        case "ARMED":
            timeLeft = parseFloat(parts[1]); isArmed = true;
            printTerminal("[!] AUTH SUCCESS: System ARMED.", "#ff3333");
            document.getElementById('sys-log').innerText = "ARMED"; document.getElementById('sys-log').style.color = "#ff3333";
            startLocalTimer();
            break;

        case "DISARMED":
            isArmed = false; timeLeft = parseFloat(parts[1]);
            printTerminal("[+] AUTH SUCCESS: System DISARMED.", "#55ff55");
            document.getElementById('sys-log').innerText = "SAFE"; document.getElementById('sys-log').style.color = "#55ff55";
            stopLocalTimer(); document.getElementById('sys-timer').innerText = timeLeft.toFixed(1) + "s";
            break;

        case "BOOM":
            isArmed = false; timeLeft = 0;
            printTerminal("[!!!] CRITICAL: C-4 DETONATED [!!!]", "#ff3333");
            document.getElementById('sys-timer').innerText = "00.0s"; document.getElementById('sys-timer').className = "data-val timer-warning";
            document.getElementById('sys-log').innerText = "DETONATED";
            stopLocalTimer();
            break;

        case "LOG": printTerminal("[C-4]: " + parts[1], "#00ffff"); break;
    }
}

function startLocalTimer() {
    if(localTimer) clearInterval(localTimer);
    document.getElementById('sys-timer').className = "data-val timer-warning";
    localTimer = setInterval(() => {
        timeLeft -= 0.1;
        if(timeLeft <= 0) { timeLeft = 0; stopLocalTimer(); }
        document.getElementById('sys-timer').innerText = timeLeft.toFixed(1) + "s";
    }, 100);
}

function stopLocalTimer() {
    if(localTimer) clearInterval(localTimer);
    localTimer = null; document.getElementById('sys-timer').className = "data-val";
}

async function transmitPayload(payload) {
    if (payload === "") return;
    if (!bleDevice || !bleDevice.gatt.connected) { printTerminal("[-] ERROR: Target offline.", "#ff3333"); return; }
    try {
        await bleCharacteristic.writeValue(new TextEncoder('utf-8').encode(payload));
    } catch (error) { printTerminal("[-] TX ERROR: " + error, "#ff3333"); }
    clearDisplay();
}