/*
 * ===========================================================================
 * FOOD FEST – SMART LUCKY SPIN MACHINE
 * ESP32 firmware  (Arduino IDE / PlatformIO, ESP32 dev board)
 * ===========================================================================
 *
 * Hardware
 *   SH1106 1.3" OLED      SDA = GPIO 21, SCL = GPIO 22   (U8g2, I2C)
 *   TM1637 4-digit        CLK = GPIO 18, DIO = GPIO 19   (TM1637Display)
 *   Servo (180°) signal   GPIO 23                        (ESP32Servo)
 *   Joystick push button  SW  = GPIO 32 (INPUT_PULLUP, pressed = LOW)
 *
 * Libraries (Library Manager):
 *   - U8g2            by oliver
 *   - TM1637Display   by Avishay Orpaz
 *   - ESP32Servo      by Kevin Harrington / John K. Bennett
 *   - ArduinoJson     by Benoit Blanchon (v7)
 *
 * HOW THE SPIN WORKS
 *   1. Backend selects the winning customer (one per completed group of three)
 *      and the prize with a CSPRNG, then stores the spin as `pending`.
 *   2. This firmware polls /api/device/current and shows the ready customer.
 *   3. Joystick press -> POST /api/device/spin/start returns the prize and the
 *      calibrated servo angle. The firmware NEVER picks a prize.
 *   4. The arrow performs the show animation (fast sweeps, slow down, suspense)
 *      and lands exactly on the backend angle.
 *   5. POST /api/device/spin/complete deducts stock exactly once. Completion is
 *      retried until the backend confirms, even across Wi-Fi drops or reboots.
 *
 * CALIBRATION
 *   Prize servo angles are set in the admin panel (Prizes -> servoAngle) and
 *   must be inside [SERVO_MIN_ANGLE, SERVO_MAX_ANGLE] and match where each
 *   physical prize sits on the wheel. Set SERVO_MIN_ANGLE / SERVO_MAX_ANGLE
 *   below to the mechanical travel of your arrow, then test with
 *   Admin -> Hardware -> servo command before the event.
 * ===========================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <TM1637Display.h>
#include <ESP32Servo.h>

// ---------------------------------------------------------------------------
// >>> EDIT THESE VALUES <<<
// ---------------------------------------------------------------------------
const char *WIFI_SSID = "KERALAVISION";
const char *WIFI_PASSWORD = "subeesh19782";

// Use https:// in production. For a LAN-only event http://192.168.x.x:4000
// works too; set API_USE_HTTPS accordingly.
const char *API_BASE = "https://your-foodfest-server.example.com";
const bool API_USE_HTTPS = true;

const char *DEVICE_ID = "FOODFEST_ESP32";
const char *DEVICE_TOKEN = "dev-device-token-change-me";  // == DEVICE_TOKEN in .env
const char *FIRMWARE_VERSION = "1.1.0";

// ---------------------------------------------------------------------------
// Pin map (fixed by the wiring)
// ---------------------------------------------------------------------------
const int PIN_OLED_SDA = 21;
const int PIN_OLED_SCL = 22;
const int PIN_TM1637_CLK = 18;
const int PIN_TM1637_DIO = 19;
const int PIN_SERVO = 23;
const int PIN_JOYSTICK_SW = 32;

// Mechanical limits of the arrow mechanism. Keep a margin from the real stops.
const int SERVO_MIN_ANGLE = 15;
const int SERVO_MAX_ANGLE = 165;
const int SERVO_IDLE_ANGLE = 15;
const int SERVO_PARK_ANGLE = 90;

// ---------------------------------------------------------------------------
// Show timing (same feel as the hand-written test sketch)
// ---------------------------------------------------------------------------
const int WINDUP_STEP = 3;      // degrees per tick on the first full sweep
const int WINDUP_MS = 5;
const int FAST_STEP = 3;        // fast to-and-fro passes
const int FAST_MS = 4;
const int FAST_PASSES = 3;
const int SLOW_STEP = 5;        // slow-down passes
const int SLOW_MS = 10;
const int SLOW_PASSES = 2;
const int RESET_MS = 200;       // arrow reset to the start of travel
const int SUSPENSE_MS = 400;    // "FINAL MOMENT" pause
const int GLIDE_MS = 1800;      // fixed glide onto the winning gift
const int SETTLE_MS = 500;      // short pause after the arrow stops
const int RESULT_HOLD_MS = 4000;

// Default duration the site uses for a phone-started spin. A device-started
// spin reports the value computed by showDurationMs() instead.

const unsigned long HEARTBEAT_INTERVAL_MS = 15000;
const unsigned long POLL_INTERVAL_MS = 1200;
const unsigned long COMMAND_POLL_INTERVAL_MS = 4000;
const unsigned long HTTP_TIMEOUT_MS = 8000;
const unsigned long SPIN_MAX_MS = 12000;  // hard safety limit for the animation

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
U8G2_SH1106_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
TM1637Display tm(PIN_TM1637_CLK, PIN_TM1637_DIO);
Servo arrowServo;

enum MachineState {
  STATE_BOOT,
  STATE_CONNECTING,
  STATE_WAITING,     // no selected customer yet
  STATE_READY,       // customer selected, press the joystick
  STATE_SPINNING,
  STATE_RESULT,
  STATE_ERROR
};

MachineState state = STATE_BOOT;

String currentCustomerName = "";
String currentCustomerNumber = "";  // zero padded, e.g. "003"
String currentPrizeName = "";
String currentSpinId = "";
int currentServoAngle = SERVO_IDLE_ANGLE;
int currentAngle = SERVO_PARK_ANGLE;
String lastError = "";

// A spin whose animation finished but whose completion POST has not been
// confirmed by the server yet. Retried from loop(), so stock is still deducted
// exactly once even if Wi-Fi dropped mid-spin or the board rebooted.
struct PendingCompletion {
  String spinId;
  String prizeName;
  String mode;
  int targetAngle;
};
PendingCompletion pendingCompletion = {"", "", "", SERVO_IDLE_ANGLE};

unsigned long lastHeartbeat = 0;
unsigned long lastPoll = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastButtonPress = 0;
bool buttonPrev = HIGH;
bool spinInFlight = false;
unsigned long spinDoneAt = 0;

// ===========================================================================
// Display helpers
// ===========================================================================
void drawCentered(const char *text, int y, const uint8_t *font) {
  display.setFont(font);
  int width = display.getStrWidth(text);
  int x = (128 - width) / 2;
  if (x < 0) x = 0;
  display.drawStr(x, y, text);
}

void drawScreen(const char *line1, const char *line2, const char *line3 = nullptr) {
  display.clearBuffer();
  drawCentered("FOOD FEST", 13, u8g2_font_7x13B_tr);
  display.drawHLine(8, 17, 112);
  drawCentered(line1, 32, u8g2_font_6x12_tr);
  drawCentered(line2, 46, u8g2_font_6x12_tr);
  if (line3 && strlen(line3) > 0) drawCentered(line3, 59, u8g2_font_5x8_tr);
  display.sendBuffer();
}

void drawStatusIcon(bool online) {
  int baseX = 116;
  int baseY = 12;
  display.drawBox(baseX, baseY - 3, 2, 3);
  display.drawBox(baseX + 4, baseY - 6, 2, 6);
  display.drawBox(baseX + 8, baseY - 9, 2, 9);
  if (!online) {
    display.drawLine(baseX - 1, baseY - 10, baseX + 11, baseY + 1);
  }
}

void renderCurrentState() {
  display.clearBuffer();
  drawCentered("FOOD FEST", 13, u8g2_font_7x13B_tr);
  drawStatusIcon(WiFi.status() == WL_CONNECTED);
  display.drawHLine(6, 17, 116);

  switch (state) {
    case STATE_BOOT:
      drawCentered("Starting up", 33, u8g2_font_6x12_tr);
      drawCentered("Please wait", 46, u8g2_font_6x12_tr);
      break;

    case STATE_CONNECTING:
      drawCentered("Connecting to Wi-Fi", 33, u8g2_font_6x12_tr);
      drawCentered(WIFI_SSID, 48, u8g2_font_5x8_tr);
      break;

    case STATE_WAITING:
      drawCentered("Waiting for next", 33, u8g2_font_6x12_tr);
      drawCentered("customer", 46, u8g2_font_6x12_tr);
      break;

    case STATE_READY: {
      String label = "Customer " + currentCustomerNumber;
      drawCentered(label.c_str(), 30, u8g2_font_6x12_tr);
      String name = currentCustomerName;
      if (name.length() > 18) name = name.substring(0, 17) + ".";
      drawCentered(name.c_str(), 43, u8g2_font_7x13B_tr);
      drawCentered("Ready to spin", 58, u8g2_font_6x12_tr);
      break;
    }

    case STATE_SPINNING:
      drawCentered("MAGIC SPIN!", 34, u8g2_font_7x13B_tr);
      drawCentered("GOOD LUCK!", 49, u8g2_font_6x12_tr);
      break;

    case STATE_RESULT: {
      drawCentered("YOU WON!", 28, u8g2_font_6x12_tr);
      String prize = currentPrizeName;
      if (prize.length() > 18) prize = prize.substring(0, 17) + ".";
      drawCentered(prize.c_str(), 44, u8g2_font_7x13B_tr);
      drawCentered("Next customer soon", 58, u8g2_font_5x8_tr);
      break;
    }

    case STATE_ERROR:
      drawCentered("Connection error", 33, u8g2_font_6x12_tr);
      drawCentered(lastError.c_str(), 47, u8g2_font_5x8_tr);
      break;
  }

  display.sendBuffer();
}

void showNumberOnTm1637(const String &text, bool colon = false) {
  // Show up to 4 digits, zero padded. 0x00 disables a digit.
  uint8_t segments[4] = {0, 0, 0, 0};
  String digits = "";
  for (size_t i = 0; i < text.length() && digits.length() < 4; i++) {
    if (isdigit(text[i])) digits += text[i];
  }
  while (digits.length() < 4) digits = "0" + digits;
  for (int i = 0; i < 4; i++) {
    segments[i] = tm.encodeDigit(digits[i] - '0');
  }
  tm.setSegments(segments, 4, colon ? 1 : 0);
}

void showTextOnTm1637(const String &text) {
  showNumberOnTm1637(text, false);
}

// ===========================================================================
// HTTP helpers
// ===========================================================================
bool apiGet(const String &path, JsonDocument &doc) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  bool started = false;

  if (API_USE_HTTPS) {
    secureClient.setInsecure();  // event LAN: no CA bundle; use a CA in production
    started = http.begin(secureClient, String(API_BASE) + path);
  } else {
    started = http.begin(plainClient, String(API_BASE) + path);
  }
  if (!started) return false;

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("x-device-token", DEVICE_TOKEN);
  http.addHeader("accept", "application/json");
  int code = http.GET();
  bool ok = false;
  if (code == 200) {
    DeserializationError err = deserializeJson(doc, http.getString());
    ok = !err;
  } else {
    Serial.printf("[api] GET %s -> %d\n", path.c_str(), code);
  }
  http.end();
  return ok;
}

bool apiPost(const String &path, JsonDocument &payload, JsonDocument *response = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String body;
  serializeJson(payload, body);

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  bool started = false;

  if (API_USE_HTTPS) {
    secureClient.setInsecure();
    started = http.begin(secureClient, String(API_BASE) + path);
  } else {
    started = http.begin(plainClient, String(API_BASE) + path);
  }
  if (!started) return false;

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);
  int code = http.POST(body);
  bool ok = (code >= 200 && code < 300);
  if (ok && response) {
    deserializeJson(*response, http.getString());
  } else if (!ok) {
    Serial.printf("[api] POST %s -> %d %s\n", path.c_str(), code, http.getString().c_str());
  }
  http.end();
  return ok;
}

// ===========================================================================
// Servo animation – the show
// ===========================================================================
int clampServo(int angle) {
  if (angle < SERVO_MIN_ANGLE) return SERVO_MIN_ANGLE;
  if (angle > SERVO_MAX_ANGLE) return SERVO_MAX_ANGLE;
  return angle;
}

void moveServo(int angle) {
  angle = clampServo(angle);
  arrowServo.write(angle);
  currentAngle = angle;
}

/** Fast sweep helper. Returns false if the safety time budget is exhausted. */
bool sweepTo(int target, int step, int stepDelay, unsigned long startedAt) {
  target = clampServo(target);
  step = max(1, step);

  while (currentAngle != target) {
    int next = currentAngle + (target > currentAngle ? step : -step);
    if ((target > currentAngle && next > target) || (target < currentAngle && next < target)) {
      next = target;
    }
    moveServo(next);
    delay(stepDelay);
    if (millis() - startedAt > SPIN_MAX_MS) return false;
  }
  return true;
}

/**
 * Total duration of the show, in milliseconds. The glide is a fixed length, so
 * the duration does not depend on the winning angle and can be sent to the
 * server BEFORE the arrow moves. The phone wheel mirrors the physical machine
 * with this exact timing.
 */
uint32_t showDurationMs() {
  const int sweep = SERVO_MAX_ANGLE - SERVO_MIN_ANGLE;
  // Phase 2 runs from SERVO_MIN_ANGLE to SERVO_MAX_ANGLE inclusive.
  const uint32_t windSteps = (sweep / WINDUP_STEP) + 1;
  const uint32_t fastSteps = (sweep + FAST_STEP - 1) / FAST_STEP;
  const uint32_t slowSteps = (sweep + SLOW_STEP - 1) / SLOW_STEP;

  return RESET_MS
       + windSteps * WINDUP_MS
       + (uint32_t)FAST_PASSES * 2 * fastSteps * FAST_MS
       + (uint32_t)SLOW_PASSES * 2 * slowSteps * SLOW_MS
       + SUSPENSE_MS
       + GLIDE_MS
       + SETTLE_MS;
}

/**
 * Full show animation, then lands exactly on finalAngle.
 *
 *   1. reset the arrow to the start of travel
 *   2. one full fast sweep to the far end
 *   3. three fast to-and-fro passes
 *   4. two slower passes (the wheel visibly loses speed)
 *   5. suspense pause
 *   6. glide onto the winning gift (always GLIDE_MS long)
 *   7. short settle pause before the result screen
 *
 * Every phase has a fixed duration, so showDurationMs() matches the animation.
 */
void animateArrow(int finalAngle) {
  finalAngle = clampServo(finalAngle);
  unsigned long startedAt = millis();

  // PHASE 1 – reset to the start of the sweep
  arrowServo.write(SERVO_MIN_ANGLE);
  currentAngle = SERVO_MIN_ANGLE;
  delay(RESET_MS);

  // PHASE 2 – first full sweep
  for (int a = SERVO_MIN_ANGLE; a <= SERVO_MAX_ANGLE; a += WINDUP_STEP) {
    moveServo(a);
    delay(WINDUP_MS);
  }
  moveServo(SERVO_MAX_ANGLE);

  // PHASE 3 – fast to-and-fro rotation
  for (int pass = 0; pass < FAST_PASSES; pass++) {
    if (!sweepTo(SERVO_MIN_ANGLE, FAST_STEP, FAST_MS, startedAt)) break;
    if (!sweepTo(SERVO_MAX_ANGLE, FAST_STEP, FAST_MS, startedAt)) break;
  }

  // PHASE 4 – slow down
  for (int pass = 0; pass < SLOW_PASSES; pass++) {
    if (!sweepTo(SERVO_MIN_ANGLE, SLOW_STEP, SLOW_MS, startedAt)) break;
    if (!sweepTo(SERVO_MAX_ANGLE, SLOW_STEP, SLOW_MS, startedAt)) break;
  }

  // PHASE 5 – winning suspense
  drawScreen("FINAL MOMENT!", "WAIT FOR IT...");
  delay(SUSPENSE_MS);

  // PHASE 6 – glide to the backend-selected gift. The per-degree delay is
  // scaled to the distance so this phase always lasts GLIDE_MS.
  int distance = abs(finalAngle - currentAngle);
  int glideDelay = distance > 0 ? max(1, GLIDE_MS / distance) : 0;
  unsigned long glideStartedAt = millis();
  while (currentAngle != finalAngle && millis() - startedAt < SPIN_MAX_MS) {
    moveServo(currentAngle + (finalAngle > currentAngle ? 1 : -1));
    delay(glideDelay);
  }
  moveServo(finalAngle);
  // Keep the glide exactly GLIDE_MS long so the reported show duration is true
  // even when GLIDE_MS is not a multiple of the travel distance.
  unsigned long glideElapsed = millis() - glideStartedAt;
  if (glideElapsed < (unsigned long)GLIDE_MS) {
    delay((unsigned long)GLIDE_MS - glideElapsed);
  }

  // PHASE 7 – settle
  delay(SETTLE_MS);
  Serial.printf("[servo] stopped at %d\n", finalAngle);
}

void parkArrow() {
  moveServo(SERVO_IDLE_ANGLE);
}

// ===========================================================================
// Spin completion retry (stock is deducted exactly once, server side)
// ===========================================================================
void rememberCompletion(const String &spinId, const String &prizeName, int angle, const String &mode) {
  pendingCompletion.spinId = spinId;
  pendingCompletion.prizeName = prizeName;
  pendingCompletion.targetAngle = angle;
  pendingCompletion.mode = mode;
}

bool postCompletion(const String &spinId, const String &prizeName, int angle, const String &mode) {
  StaticJsonDocument<512> payload;
  payload["spin_id"] = spinId;
  payload["device_id"] = DEVICE_ID;
  payload["prize_name"] = prizeName;
  payload["target_angle"] = angle;
  payload["mode"] = mode;

  StaticJsonDocument<512> response;
  bool ok = apiPost("/api/device/spin/complete", payload, &response);
  if (ok) Serial.printf("[spin] %s completed on server\n", spinId.c_str());
  return ok;
}

/** Called from loop(): retries an unconfirmed completion until it succeeds. */
void flushPendingCompletion() {
  if (pendingCompletion.spinId.length() == 0) return;
  if (WiFi.status() != WL_CONNECTED || spinInFlight) return;

  if (postCompletion(
        pendingCompletion.spinId,
        pendingCompletion.prizeName,
        pendingCompletion.targetAngle,
        pendingCompletion.mode)) {
    pendingCompletion.spinId = "";
    pendingCompletion.prizeName = "";
    pendingCompletion.mode = "";
    lastError = "";
  } else {
    lastError = "Sync retry pending";
    Serial.println("[spin] completion retry failed, will try again");
  }
}

// ===========================================================================
// Device state
// ===========================================================================
void animatePendingSpin(const String &spinId, const String &customerNumber,
                        const String &customerName, const String &prizeName,
                        int angle, const String &mode) {
  currentSpinId = spinId;
  currentCustomerNumber = customerNumber;
  currentCustomerName = customerName;
  currentPrizeName = prizeName;
  currentServoAngle = clampServo(angle);

  showNumberOnTm1637(currentCustomerNumber);

  state = STATE_SPINNING;
  renderCurrentState();

  spinInFlight = true;
  animateArrow(currentServoAngle);
  spinInFlight = false;

  state = STATE_RESULT;
  renderCurrentState();

  if (!postCompletion(currentSpinId, currentPrizeName, currentServoAngle, mode)) {
    rememberCompletion(currentSpinId, currentPrizeName, currentServoAngle, mode);
    Serial.println("[spin] completion not confirmed, queued for retry");
  }

  currentSpinId = "";
  spinDoneAt = millis();
}

void applyDeviceCurrent(JsonDocument &doc) {
  const char *mode = doc["mode"] | "real";
  const char *status = doc["status"] | "waiting";

  if (strcmp(status, "spin_pending") == 0) {
    String spinId = doc["spin_id"] | "";

    // Already animated on this board, only the completion POST is outstanding.
    if (pendingCompletion.spinId.length() > 0 && pendingCompletion.spinId == spinId) {
      flushPendingCompletion();
      return;
    }
    if (spinInFlight) return;

    // A spin created from the dashboard (or a device retry) is animated here.
    animatePendingSpin(
      spinId,
      doc["customer_number_label"] | "",
      doc["customer_name"] | "",
      doc["prize_name"] | "",
      doc["target_angle"] | SERVO_IDLE_ANGLE,
      mode);
    return;
  }

  if (strcmp(status, "ready") == 0) {
    currentCustomerNumber = doc["customer_number_label"] | "";
    currentCustomerName = doc["customer_name"] | "";
    currentPrizeName = "";
    currentSpinId = "";
    showNumberOnTm1637(currentCustomerNumber);
    if (state != STATE_SPINNING) {
      state = STATE_READY;
      renderCurrentState();
    }
    return;
  }

  if (strcmp(status, "paused") == 0) {
    currentCustomerName = "";
    currentCustomerNumber = "";
    tm.clear();
    state = STATE_WAITING;
    lastError = "Event paused";
    renderCurrentState();
    return;
  }

  if (strcmp(status, "no_prizes") == 0) {
    currentCustomerName = "";
    currentCustomerNumber = "";
    tm.clear();
    state = STATE_ERROR;
    lastError = "No prize available";
    renderCurrentState();
    return;
  }

  // waiting
  if (state != STATE_RESULT) {
    currentCustomerName = "";
    currentCustomerNumber = "";
    tm.clear();
    state = STATE_WAITING;
    renderCurrentState();
  }
}

void pollCurrent() {
  StaticJsonDocument<1024> doc;
  if (!apiGet("/api/device/current", doc)) {
    if (WiFi.status() == WL_CONNECTED) {
      state = STATE_ERROR;
      lastError = "Server unreachable";
      renderCurrentState();
    }
    return;
  }
  lastError = "";
  applyDeviceCurrent(doc);
}

void startRealSpin() {
  StaticJsonDocument<320> payload;
  // Unique idempotency key for this press: retried requests reuse it, so the
  // backend can never create two spins from one joystick press.
  char key[48];
  snprintf(key, sizeof(key), "ESP32-%08X-%lu", (unsigned)esp_random(), (unsigned long)millis());
  String idempotencyKey = String(key);
  payload["device_id"] = DEVICE_ID;
  payload["spin_id"] = idempotencyKey;
  // The ESP32 owns the show timing: the site mirrors this exact duration.
  payload["animation_ms"] = showDurationMs();

  StaticJsonDocument<512> response;
  if (!apiPost("/api/device/spin/start", payload, &response)) {
    state = STATE_ERROR;
    lastError = "Spin request failed";
    renderCurrentState();
    delay(1500);
    pollCurrent();
    return;
  }

  String spinId = response["spin_id"] | "";
  String prizeName = response["prize_name"] | "";
  int angle = response["target_angle"] | SERVO_IDLE_ANGLE;

  Serial.printf("[spin] %s -> %s (servo %d)\n", spinId.c_str(), prizeName.c_str(), angle);

  animatePendingSpin(
    spinId,
    response["customer_number_label"] | "",
    response["customer_name"] | "",
    prizeName,
    angle,
    response["mode"] | "real");

  delay(RESULT_HOLD_MS);
  pollCurrent();
}

// ===========================================================================
// Commands (test displays / servo from the admin panel)
// ===========================================================================
void handleCommands() {
  StaticJsonDocument<2048> doc;
  if (!apiGet("/api/device/commands", doc)) return;

  JsonArray commands = doc["commands"].as<JsonArray>();
  for (JsonObject command : commands) {
    String id = command["id"] | "";
    String type = command["type"] | "";
    JsonObject payload = command["payload"].as<JsonObject>();

    if (type == "oled") {
      String l1 = payload["line1"] | "FOOD FEST";
      String l2 = payload["line2"] | "";
      String l3 = payload["line3"] | "";
      drawScreen(l1.c_str(), l2.c_str(), l3.c_str());
      delay(400);
      renderCurrentState();
    } else if (type == "tm1637") {
      String text = payload["text"] | "0000";
      showTextOnTm1637(text);
    } else if (type == "servo") {
      int angle = payload["angle"] | SERVO_PARK_ANGLE;
      moveServo(clampServo(angle));
      delay(600);
    } else if (type == "reset") {
      parkArrow();
      tm.clear();
      state = STATE_CONNECTING;
      renderCurrentState();
      lastError = "";
      Serial.println("[cmd] reset");
    }

    StaticJsonDocument<128> ack;
    ack["id"] = id;
    apiPost("/api/device/commands/" + id + "/ack", ack);
    Serial.printf("[cmd] %s acked\n", type.c_str());
  }
}

// ===========================================================================
// Wi-Fi / heartbeat
// ===========================================================================
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  state = STATE_CONNECTING;
  renderCurrentState();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[wifi] connected, IP ");
    Serial.println(WiFi.localIP());
    lastError = "";
  } else {
    lastError = "Wi-Fi offline";
    state = STATE_ERROR;
    renderCurrentState();
  }
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return;
  }
  StaticJsonDocument<256> payload;
  payload["device_id"] = DEVICE_ID;
  payload["firmware_version"] = FIRMWARE_VERSION;
  if (!apiPost("/api/device/heartbeat", payload)) {
    Serial.println("[heartbeat] failed");
  }
  lastHeartbeat = millis();
}

// ===========================================================================
// Setup / loop
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[foodfest] start");

  pinMode(PIN_JOYSTICK_SW, INPUT_PULLUP);

  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  display.begin();
  display.setContrast(200);
  renderCurrentState();

  tm.setBrightness(7);
  tm.clear();

  arrowServo.setPeriodHertz(50);
  arrowServo.attach(PIN_SERVO, 500, 2400);
  arrowServo.write(SERVO_MIN_ANGLE);
  currentAngle = SERVO_MIN_ANGLE;

  state = STATE_CONNECTING;
  renderCurrentState();
  connectWifi();
  sendHeartbeat();
  pollCurrent();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  unsigned long now = millis();

  if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
  }

  // Finish any unconfirmed spin first so stock can never be lost.
  flushPendingCompletion();

  // Keep the result visible for a moment, then return to the ready screen.
  if (state == STATE_RESULT && now - spinDoneAt > RESULT_HOLD_MS) {
    state = STATE_WAITING;
    renderCurrentState();
  }

  if (now - lastPoll > POLL_INTERVAL_MS && !spinInFlight) {
    pollCurrent();
    lastPoll = now;
  }

  if (now - lastCommandPoll > COMMAND_POLL_INTERVAL_MS && !spinInFlight) {
    handleCommands();
    lastCommandPoll = now;
  }

  // Joystick press: only a REAL-mode ready customer may start a spin.
  bool button = digitalRead(PIN_JOYSTICK_SW);
  if (buttonPrev == HIGH && button == LOW && now - lastButtonPress > 800) {
    lastButtonPress = now;
    Serial.println("[joystick] pressed");
    if (state == STATE_READY && !spinInFlight && WiFi.status() == WL_CONNECTED) {
      startRealSpin();
    } else if (state == STATE_WAITING) {
      drawScreen("No customer ready", "Waiting for", "next registration");
      delay(1200);
      renderCurrentState();
    }
  }
  buttonPrev = button;

  delay(40);
}
