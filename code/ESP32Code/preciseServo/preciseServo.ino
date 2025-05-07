// Authors: Hudson Reynolds, Some help from Dakota Winslow and ChatGPT.
// Controls two servos:
//   - servo1 (on S1, GPIO 18) is controlled by the D-pad:
//         D-pad RIGHT  -> run belt motor on electromagnet pin
//         D-pad LEFT -> stop belt motor
//         Otherwise, holds its last commanded value.
//   - servo2 (on S2, GPIO 19) is controlled by throttle and brake:
//         Throttle pressed (above threshold) → increments angle toward 180°
//         Brake pressed (above threshold) → decrements angle toward 0°
//         Otherwise, holds its current angle.
// Also controls motors via a shift register and uses Bluepad32 for controller input.
// Used 4 mechanum wheels, Acebot Max ESP32 V1.0 board, Hi-letgo HW-130 motor driver shield, 4 tt motors without encoders, a 12v 1amp battery

#include <Arduino.h>
#include <Bluepad32.h>
#include <ShiftRegister74HC595.h>
#include <ESP32Servo.h>

// ----- Pin Definitions -----
#define LED_BUILTIN 2

// Motor pins.
#define M1 17  // Front left
#define M2 26  // Front right
#define M3 13  // Back left
#define M4 14  // Back right

// Motor direction reversals.
#define M1_REV false
#define M2_REV true
#define M3_REV false
#define M4_REV false

// LEDC channels for motors.
#define M1_CHANNEL 4
#define M2_CHANNEL 5
#define M3_CHANNEL 6
#define M4_CHANNEL 7

// Servo pins.
#define S1 18   // Servo1 control (D-pad controlled)
#define S2 19   // Servo2 control (Throttle/Brake controlled)

// Shift register pins (for motor direction control).
#define SR_DATA 23
#define SR_CLK 25
#define SR_LTCH 16
#define SR_EN 4

// Motor control definitions.
#define OFF 0b00  
#define FWD 0b01 
#define REV 0b10

// Speed definitions.
#define NORMAL_SPEED 220
#define PRECISION_SPEED 152

// Electromagnet definitions.
#define EMAG_IN1 27
#define EMAG_EN 33
#define EMAG_PWM_DUTY 165
#define EMAG_PWM_CHANNEL 2  // LEDC channel 2

// LEDC settings for motors.
const int motorPWMFreq = 5000;      // 5 kHz
const int motorPWMResolution = 8;   // 8-bit (0-255)

// ----- Global Objects -----
ShiftRegister74HC595<1> SR(SR_DATA, SR_CLK, SR_LTCH);
uint8_t motor_state = 0x00;
Servo servo1;   // Controlled by D-pad
Servo servo2;   // Controlled by throttle/brake

// ----- Global Variables for Servo Control -----
// For servo1:
volatile int servo_command = 0;  // +1 for D-pad UP, -1 for D-pad DOWN; remains unchanged otherwise.
int current_servo_angle = 90;      // Starting at center

// For servo2 (robotic arm):
int servo2_angle = 90;             // Starting at center
const int servo2Step = 5;          // Increase servo2 angle in 5° increments per cycle

// Global motor command variables.
volatile int m1_cmd = 0;
volatile int m2_cmd = 0;
volatile int m3_cmd = 0;
volatile int m4_cmd = 0;

// Global variables for throttle/brake values:
volatile int throttle_value = 0;   // 0 - 1023
volatile int brake_value = 0;      // 0 - 1023

// ----- Motor Control Functions (using LEDC) -----
void setM1(uint8_t speed, uint8_t dir) {
  if (M1_REV) dir = ~dir;
  motor_state &= ~(0b00001100);
  motor_state |= (dir << 2);
  uint8_t tmp = motor_state;
  SR.setAll(&tmp);
  ledcWrite(M1_CHANNEL, speed);
}

void setM2(uint8_t speed, uint8_t dir) {
  if (M2_REV) dir = ~dir;
  motor_state &= ~(0b00010010);
  motor_state |= (dir & 0b10);
  motor_state |= ((dir & 0b01) << 4);
  uint8_t tmp = motor_state;
  SR.setAll(&tmp);
  ledcWrite(M2_CHANNEL, speed);
}

void setM3(uint8_t speed, uint8_t dir) {
  if (M3_REV) dir = ~dir;
  motor_state &= ~(0b10100000);
  motor_state |= ((dir & 0b10) << 4);
  motor_state |= ((dir & 0b01) << 7);
  uint8_t tmp = motor_state;
  SR.setAll(&tmp);
  ledcWrite(M3_CHANNEL, speed);
}

void setM4(uint8_t speed, uint8_t dir) {
  if (M4_REV) dir = ~dir;
  motor_state &= ~(0b01000001);
  motor_state |= ((dir & 0b10) << 5);
  motor_state |= (dir & 0b01);
  uint8_t tmp = motor_state;
  SR.setAll(&tmp);
  ledcWrite(M4_CHANNEL, speed);
}

void setM1Signed(int value) {
  if (value > 0)
    setM1((uint8_t)abs(value), FWD);
  else if (value < 0)
    setM1((uint8_t)abs(value), REV);
  else
    setM1(0, OFF);
}

void setM2Signed(int value) {
  if (value > 0)
    setM2((uint8_t)abs(value), FWD);
  else if (value < 0)
    setM2((uint8_t)abs(value), REV);
  else
    setM2(0, OFF);
}

void setM3Signed(int value) {
  if (value > 0)
    setM3((uint8_t)abs(value), FWD);
  else if (value < 0)
    setM3((uint8_t)abs(value), REV);
  else
    setM3(0, OFF);
}

void setM4Signed(int value) {
  if (value > 0)
    setM4((uint8_t)abs(value), FWD);
  else if (value < 0)
    setM4((uint8_t)abs(value), REV);
  else
    setM4(0, OFF);
}

// ----- Bluepad32 Callbacks -----
ControllerPtr myControllers[BP32_MAX_GAMEPADS] = { nullptr };

void onConnectedController(ControllerPtr ctl) {
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == nullptr) {
      Serial.printf("CALLBACK: Controller connected, index=%d\n", i);
      ControllerProperties properties = ctl->getProperties();
      Serial.printf("Model: %s, VID=0x%04x, PID=0x%04x\n", ctl->getModelName().c_str(), properties.vendor_id, properties.product_id);
      myControllers[i] = ctl;
      return;
    }
  }
  Serial.println("CALLBACK: Controller connected but no empty slot found");
}

void onDisconnectedController(ControllerPtr ctl) {
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == ctl) {
      Serial.printf("CALLBACK: Controller disconnected from index=%d\n", i);
      myControllers[i] = nullptr;
      return;
    }
  }
  Serial.println("CALLBACK: Controller disconnected but not found");
}

// ----- Bluetooth Task -----
// Updates controller data for motor commands, servo1 D-pad command, and throttle/brake values.
void bluetoothTask(void * parameter) {
  const int DEADZONE = 200;  // Adjust as needed
  while (true) {
    bool dataUpdated = BP32.update();
    if (dataUpdated) {
      // Process only the first connected controller.
      for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
        ControllerPtr ctl = myControllers[i];
        if (ctl && ctl->isConnected() && ctl->hasData()) {
          /* Controller from Bluepad32 controller example:
          ctl->index(),        // Controller Index
          ctl->dpad(),         // D-pad
          ctl->buttons(),      // bitmask of pressed buttons
          ctl->axisX(),        // (-511 - 512) left X Axis
          ctl->axisY(),        // (-511 - 512) left Y axis
          ctl->axisRX(),       // (-511 - 512) right X axis
          ctl->axisRY(),       // (-511 - 512) right Y axis
          ctl->brake(),        // (0 - 1023): brake button
          ctl->throttle(),     // (0 - 1023): throttle (AKA gas) button
          ctl->miscButtons(),  // bitmask of pressed "misc" buttons
          ctl->gyroX(),        // Gyro X
          ctl->gyroY(),        // Gyro Y
          ctl->gyroZ(),        // Gyro Z
          ctl->accelX(),       // Accelerometer X
          ctl->accelY(),       // Accelerometer Y
          ctl->accelZ()        // Accelerometer Z */

          // --- Motor Mixing (unchanged) ---
          int raw_lx = ctl->axisX();
          int raw_ly = ctl->axisY();
          int raw_rx = ctl->axisRX();
          int rx = -raw_rx;
          int lx = (abs(raw_lx) < DEADZONE) ? 0 : raw_lx;
          int ly = (abs(raw_ly) < DEADZONE) ? 0 : raw_ly;
          rx = (abs(rx) < DEADZONE) ? 0 : rx;
          ly = -ly;  // Invert so forward is positive
          int rawFL = ly + lx + rx;
          int rawFR = ly - lx - rx;
          int rawBL = ly - lx + rx;
          int rawBR = ly + lx - rx;
          bool precisionMode = (ctl->buttons() & 0x0020) != 0;
          float desiredMax = precisionMode ? PRECISION_SPEED : NORMAL_SPEED;
          int maxVal = max(max(abs(rawFL), abs(rawFR)), max(abs(rawBL), abs(rawBR)));
          float factor = (maxVal > desiredMax) ? desiredMax / (float)maxVal : 1.0;
          m1_cmd = rawFL * factor;
          m2_cmd = rawFR * factor;
          m3_cmd = rawBL * factor;
          m4_cmd = rawBR * factor;
 
          // --- D-pad and Electromagnet ---
          uint8_t dpad = ctl->dpad();
          Serial.printf("Dpad value: 0x%02X\n", dpad);
          if (dpad & 0x04) { // left 
              digitalWrite(EMAG_IN1, HIGH);
              ledcWrite(EMAG_PWM_CHANNEL, EMAG_PWM_DUTY);
          } else if (dpad & 0x08) { 
              ledcWrite(EMAG_PWM_CHANNEL, 0);
              digitalWrite(EMAG_IN1, LOW);
          }
 
          // --- Servo1 Command Update (D-pad) ---
          // D-pad UP -> command +1 (target 180°)
          // D-pad DOWN -> command -1 (target 0°)
          if ((dpad & 0x01) && !(dpad & 0x02)) {
              servo_command = 1;
          } else if ((dpad & 0x02) && !(dpad & 0x01)) {
              servo_command = -1;
          }
          // If no D-pad command, keep last value.
 
          // --- Throttle and Brake Values for servo2 ---
          throttle_value = ctl->throttle();
          brake_value = ctl->brake();
          Serial.printf("Throttle: %4d, Brake: %4d\n", throttle_value, brake_value);
 
          break; // Process only one controller.
        }
      }
    }
    vTaskDelay(20 / portTICK_PERIOD_MS);
  }
}

// ----- Driving Task -----
// Continuously outputs motor and servo PWM.
// Servo1 is driven to the last D-pad commanded angle.
// Servo2 increments or decrements based on throttle/brake input.
void drivingTask(void * parameter) {
  const int analogThreshold = 100;  // Minimum analog value to consider "pressed"
  while (true) {
    // --- Update Motors ---
    setM1Signed(m1_cmd);
    setM2Signed(m2_cmd);
    setM3Signed(m3_cmd);
    setM4Signed(m4_cmd);
    
    // --- Update Servo1 (D-pad controlled) ---
    int targetAngle = current_servo_angle;  // Default: hold last value.
    if (servo_command == 1) {
      targetAngle = 180;
    } else if (servo_command == -1) {
      targetAngle = 0;
    }
    if (targetAngle != current_servo_angle) {
      current_servo_angle = targetAngle;
      Serial.printf("Servo1 commanded to %d°\n", current_servo_angle);
    }
    servo1.write(current_servo_angle);
    
    // --- Update Servo2 (Throttle/Brake controlled) ---
    if (throttle_value > analogThreshold && brake_value <= analogThreshold) {
      if (servo2_angle < 180) {
        servo2_angle += servo2Step;
        if (servo2_angle > 180) servo2_angle = 180;
        Serial.printf("Servo2 commanded to %d° (Throttle pressed)\n", servo2_angle);
      }
    }
    else if (brake_value > analogThreshold && throttle_value <= analogThreshold) {
      if (servo2_angle > 0) {
        servo2_angle -= servo2Step;
        if (servo2_angle < 0) servo2_angle = 0;
        Serial.printf("Servo2 commanded to %d° (Brake pressed)\n", servo2_angle);
      }
    }
    servo2.write(servo2_angle);
    
    vTaskDelay(20 / portTICK_PERIOD_MS);
  }
}

// ----- Setup and Loop -----
void setup() {
  Serial.begin(115200);
  Serial.println("Starting RASTICxHackH Spring 2025 Bluetooth Controller...");
  
  // --- Pin Mode Setup ---
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(M1, OUTPUT);
  pinMode(M2, OUTPUT);
  pinMode(M3, OUTPUT);
  pinMode(M4, OUTPUT);
  // Shift register pins:
  pinMode(SR_DATA, OUTPUT);
  pinMode(SR_CLK, OUTPUT);
  pinMode(SR_LTCH, OUTPUT);
  pinMode(SR_EN, OUTPUT);
  // Electromagnet pins:
  pinMode(EMAG_IN1, OUTPUT);
  pinMode(EMAG_EN, OUTPUT);
  
  // --- Shift Register Initialization ---
  uint8_t tmp = 0;
  SR.setAll(&tmp);
  digitalWrite(SR_EN, LOW);  // Assuming active-low enable
  
  // --- Motor LEDC Setup ---
  ledcSetup(M1_CHANNEL, motorPWMFreq, motorPWMResolution);
  ledcAttachPin(M1, M1_CHANNEL);
  ledcSetup(M2_CHANNEL, motorPWMFreq, motorPWMResolution);
  ledcAttachPin(M2, M2_CHANNEL);
  ledcSetup(M3_CHANNEL, motorPWMFreq, motorPWMResolution);
  ledcAttachPin(M3, M3_CHANNEL);
  ledcSetup(M4_CHANNEL, motorPWMFreq, motorPWMResolution);
  ledcAttachPin(M4, M4_CHANNEL);
  
  // --- Electromagnet LEDC Setup ---
  ledcSetup(EMAG_PWM_CHANNEL, 10000, 8);
  ledcAttachPin(EMAG_EN, EMAG_PWM_CHANNEL);
  digitalWrite(EMAG_IN1, LOW);
  ledcWrite(EMAG_PWM_CHANNEL, 0);
  
  // --- Servo Setup ---
  servo1.setPeriodHertz(50);
  servo1.attach(S1, 500, 2400);
  current_servo_angle = 0;
  servo1.write(current_servo_angle);
  
  servo2.setPeriodHertz(50);
  servo2.attach(S2, 500, 2400);
  servo2_angle = 90;
  servo2.write(servo2_angle);
  
  // --- Bluepad32 Setup ---
  BP32.setup(&onConnectedController, &onDisconnectedController);
  BP32.forgetBluetoothKeys();
  BP32.enableVirtualDevice(false);
  
  // --- Create Tasks ---
  xTaskCreatePinnedToCore(bluetoothTask, "BluetoothTask", 4096, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(drivingTask, "DrivingTask", 4096, NULL, 1, NULL, 1);
}
 
void loop() {
  vTaskDelay(1000 / portTICK_PERIOD_MS);
}
