var five = require("johnny-five"),
  keypress = require("keypress"),
  tinycolor = require("tinycolor2"),
  util = require("util");
var exec = require("child_process").exec;
var EventEmitter = require('events').EventEmitter;

/*
 Inputs we want to handle:
 X "panic" button -> faster beat
 X "hue" button -> hue selection mode
 X heartbeat sensor (as button) -> deactivate autobeat, use sensor beat
 - tap piezos -> same as heartbeat sensor, but with different sound file

*/

Heart = function() {
  led_opts = {
    pins: {
     red: 11,
     green: 10,
     blue: 9
    },
    isAnode: false
  }
  this.value_min=0.2;
  this.value_max=1.0;
  this.beat_time = 500; // ms
  this.default_beat_period = 1200; // ms
  this.panic_beat_period = 400;
  this.beat_period = this.default_beat_period;
  this.manual_beat_timeout = 5000; // ms

  this.hue_period = 60;
  this.hue_delta = 2;

  this.led = new five.Led.RGB(led_opts);
  this.setHue(0);

  this.child = null;
  this.beat_source = null;
  this.hue_selection_source = null;
  this.manual_timeout_source = null;

  this.mode = null;
  this.setMode(Heart.AUTOBEAT);
}

// modes
Heart.AUTOBEAT = 1;
Heart.HUESELECT = 2;
Heart.MANUALBEAT = 3;

// 0 - 360
Heart.prototype.setHue = function(hue) {
  this.hue = hue;

  // compute low and high colors for these hues, store them in format accepted
  // by Led.color()
  var low_color_tiny = tinycolor({h:this.hue, s:1., v:this.value_min})
  var low_rgb = low_color_tiny.toRgb();
  this.low_color = [low_rgb.r, low_rgb.g, low_rgb.b];

  var high_color_tiny = tinycolor({h:this.hue, s:1., v:this.value_max})
  var high_rgb = high_color_tiny.toRgb();
  this.high_color = [high_rgb.r, high_rgb.g, high_rgb.b];

  this.led.color(this.high_color);
}

Heart.prototype.startHueSelection = function() {
  this.stopBeat();

  var updateHue = function(){
    this.setHue((this.hue + this.hue_delta) % 360);
  }.bind(this);

  this.colorFade(this.high_color, 500, function() {
      this.hue_selection_source = setInterval(updateHue, this.hue_period);
    }.bind(this));

  this.child = exec("play -q data/tadaa.wav vol 0.1", sound_finish); // ugly?
  var sound_finish = function() {
    this.child = null;
  }.bind(this);
}

Heart.prototype.stopHueSelection = function () {
  if (!this.hue_selection_source)
    return;
  clearInterval(this.hue_selection_source);
  this.hue_selection_source = null;
  this.colorFade(this.low_color, 500, function() {
      this.child.kill('SIGKILL');
      this.child = null;
      this.startBeat();
    }.bind(this));
}

Heart.prototype.beat = function(silent) {
  var fadeOut = function() {
    this.colorFade(this.low_color, this.beat_time/2);
  }.bind(this);

  this.colorFade(this.high_color, this.beat_time/2, fadeOut);

  if (!silent) {
   if (this.child) {
    this.child.kill('SIGKILL');
    this.child = null;
   }
   this.child = exec("play -q data/heartbeat.wav", sound_finish); // ugly?
   var sound_finish = function() {
    this.child = null;
   }.bind(this);
  }
}

function ease_step(step) {
  return function(delta) {
    var new_delta = Math.sin(delta * Math.PI / 2);
    return step(new_delta);
  };
}

Heart.prototype.colorFade = function(target_color, time, callback) {
  var current_color = this.led.color()
  var params_red = { start: current_color.red,
                     update: target_color[0] - current_color.red };
  var params_green = { start: current_color.green,
                     update: target_color[1] - current_color.green };
  var params_blue = { start: current_color.blue,
                     update: target_color[2] - current_color.blue };

  var step = function(delta) {
    var red = params_red.start + params_red.update * delta;
    var green = params_green.start + params_green.update * delta;
    var blue = params_blue.start + params_blue.update * delta;
    this.led.color([red, green, blue]);

  }.bind(this);

  var complete = function() {
    this.led.stop();
    if (typeof callback === "function") {
      callback();
    }
  }.bind(this);

  // We use this.led.green as a ugly hack to access the animation system
  // already implemented in johnny-five
  return this.led.green.animate({
    duration: time || 1000,
    complete: complete,
    step: ease_step(step)
  });
}

Heart.prototype.setMode = function(mode) {
  switch(mode) {
    case Heart.AUTOBEAT:
      console.log("auto beat");
      this.stopHueSelection();
      this.startBeat();
      break;
    case Heart.HUESELECT:
      console.log("hue selection")
      this.stopBeat();
      this.startHueSelection();
      break;
    case Heart.MANUALBEAT:
      console.log("manual beat");
      this.stopHueSelection();
      this.stopBeat();
      break;
    default:
      console.log("Warning! unknown mode: " + mode);
      break;
  }

  if (mode != Heart.MANUALBEAT && this.manual_timeout_source) {
    clearTimeout(this.manual_timeout_source);
    this.manual_timeout_source = null;
  }

  this.mode = mode;
}

Heart.prototype.startBeat = function() {
  if (this.beat_source)
    return; // already beatin

  var doBeat = function() {
    this.beat();
    if (this.beat_period)
     this.beat_source = setTimeout(doBeat, this.beat_period);
  }.bind(this);

  doBeat();
}

Heart.prototype.stopBeat = function() {
  if (this.beat_source) {

    clearTimeout(this.beat_source);
    this.beat_source = null;
  }
}

/* level is between 0 (calm) and 1 (total panic) */
Heart.prototype.panic_level = function(level) {
  if (level < 0.0 || level > 1.0) {
    console.log("Warning: panic level out of range (ignoring): " + level);
    return;
  }
  var difference = this.default_beat_period - this.panic_beat_period;
  this.beat_period = this.default_beat_period - level * difference;
}

Panic = function(heart, button_pins, led_pin) {
  if (button_pins.length === 0) {
    console.log("not enough buttons for Panic, ignoring");
    return null;
  }
  this.led = new five.Led(led_pin);
  this.buttons = []
  this.buttons_pressed = 0;
  this.max_buttons = button_pins.length;
  function count_buttons_down (buttons) {
    var total = 0;
    buttons.forEach(function(button) {
      total += (button.isDown | 0);
    });
    return total;
  }
  button_pins.forEach(function(pin) {
    var button = new five.Button(pin);
    this.buttons.push(button);
    var on_button_change = function() {
      this.buttons_pressed = count_buttons_down(this.buttons);
      heart.panic_level(this.buttons_pressed/this.max_buttons);
      if (this.buttons_pressed > 0) {
        this.led.on();
      } else {
        this.led.off();
      }
    }.bind(this);
    button.on("down", on_button_change);
    button.on("up", on_button_change);
  }.bind(this));
}

Hue = function(heart, pin) {
  this.sensor = new TouchSensor(pin);
  this.sensor.on("down", function() {
    heart.setMode(Heart.HUESELECT);
  }.bind(this));
  this.sensor.on("up", function() {
    heart.setMode(Heart.AUTOBEAT);
  }.bind(this));
}

// beater is something that sends a "beat" signal
ManualBeater = function(heart, beater) {
  this.heart = heart;
  this.beater = beater;
  this.beater.on("beat", function() {
    if (this.heart.mode === Heart.HUESELECT)
      return;
    var reset = function() {
      console.log("manual beat timeout!");
      this.heart.setMode(Heart.AUTOBEAT);
    }.bind(this);

    if (this.heart.mode !== Heart.MANUALBEAT) {
      this.heart.setMode(Heart.MANUALBEAT);
    }
    if (this.heart.manual_timeout_source)
      clearTimeout(this.heart.manual_timeout_source);

    this.heart.manual_timeout_source = setTimeout(reset,
                                            this.heart.manual_beat_timeout);
    exec("play -q data/one_beat.wav");
    this.heart.beat(true);
  }.bind(this));
}

TouchSensor = function (pin) {
    this.sensor = new five.Sensor({
        pin: pin,
        freq: 10,
        range: [0, 1023],
        threshold: 15
    });

    this.touched = false;
    this.last_val = this.sensor.value;

    this.sensor.scale([0, 1023]).on("data", function () {
      var difference = this.sensor.value - this.last_val;
      if (Math.abs(difference) > this.sensor.threshold) {
        if (!this.touched && difference < 0) {
          this.touched = true;
          this.emit("down");
        } else if (this.touched && difference > 0) {
          this.touched = false;
          this.emit("up");
        }
      }
    this.last_val = this.sensor.value;
    }.bind(this));
}
util.inherits(TouchSensor, EventEmitter);

PiezoSensor = function(pin, low_threshold, high_threshold) {
    this.sensor = new five.Sensor({
        pin: pin,
        freq: 10,
        range: [0, 1023],
    });

    this.activated = true;
    this.low_threshold = low_threshold;
    this.high_threshold = high_threshold;

    this.sensor.on("data", function() {
      if (!this.activated && this.sensor.value > this.high_threshold) {
        console.log("beat");
        this.activated = true;
        this.emit("beat", this.sensor.value);
      } else if (this.activated && this.sensor.value < this.low_threshold) {
        console.log("disarm");
        this.activated = false;
      }
    }.bind(this));
}
util.inherits(PiezoSensor, EventEmitter);

Controller = function(heart) {
  this.heart = heart;

  this.panic = new Panic(heart, [2,4,7], 13);

  this.beater = new ManualBeater(heart, new PiezoSensor("A1", 10, 100));

  this.hue = new Hue(heart, "A0");
}

five.Board().on("ready", function() {
  var heart = new Heart();
  var controller = new Controller(heart);

  this.repl.inject({
    heart: heart,
    board: this
  });


});

