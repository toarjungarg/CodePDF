// A made-up sketch that blinks an LED and reads a light sensor.
#include <Servo.h>
#include "pins.h"

#define SENSOR_PIN A0
#define BLINK_MS 500UL

/* Wiring:
   LED on pin 13 (the built-in one), sensor on A0. */

const int THRESHOLD = 0x1F4;
unsigned long lastBlink = 0;
bool ledOn = false;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  Serial.begin(9600);
  Serial.println("Sensor demo // not a comment");
}

void loop() {
  int reading = analogRead(SENSOR_PIN);
  if (millis() - lastBlink >= BLINK_MS) {
    lastBlink = millis();
    ledOn = !ledOn;
    digitalWrite(LED_BUILTIN, ledOn ? HIGH : LOW);
  }
  if (reading > THRESHOLD) {
    Serial.print("bright: ");
    Serial.println(reading);
  }
  delay(10);
}
