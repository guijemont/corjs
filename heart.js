var five = require("johnny-five"),
  keypress = require("keypress"),
  tinycolor = require("tinycolor2");
var exec = require("child_process").exec;

/*
 Inputs we want to handle:
 X "panic" button -> faster beat
 - "hue" button -> hue selection mode
 - heartbeat sensor (as button) -> deactivate autobeat, use sensor beat
 - tap piezos -> same as heartbeat sensor, but with different sound file

*/

Heart = function() {
  led_opts = {
    pins: {
     red: 11,
     green: 10,
     blue: 9
    },
    isAnode: true
  }
  this.value_min=0.2;
  this.value_max=1.0;
  this.beat_time = 400; // ms
  this.default_beat_period = 1000; // ms
  this.panic_beat_period = 500;
  this.beat_period = this.default_beat_period;

  this.led = new five.Led.RGB(led_opts);
  this.setHue(0);

  this.child = null;
  this.beat_source = null;

  this.startBeat();
}

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

  this.led.color(this.low_color);
}

Heart.prototype.beat = function() {
  var fadeOut = function() {
    this.colorFade(this.low_color, this.beat_time/2);
  }.bind(this);

  this.colorFade(this.high_color, this.beat_time/2, fadeOut);

  if (this.child) {
    this.child.kill();
    this.child = null;
  }
  this.child = exec("play -q data/heartbeat.wav", sound_finish); // ugly?
  var sound_finish = function() {
    this.child = null;
  }.bind(this);
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

Heart.prototype.panic = function() {
  this.beat_period = this.panic_beat_period;
}

Heart.prototype.calmDown = function() {
  this.beat_period = this.default_beat_period;
}

Panic = function(heart, button_pin, led_pin) {
  this.button = new five.Button(button_pin);
  this.led = new five.Led(led_pin);
  this.button.on("down", function() {
    heart.panic();
    this.led.on();
  }.bind(this));
  this.button.on("up", function() {
    heart.calmDown();
    this.led.off();
  }.bind(this));
}

Hue = function(heart, pin) {
  this.button = five.Button(pin);
  this.button.on("down", function() {
    console.log("hue selection mode");
  }.bind(this));
  this.button.on("up", function() {
    console.log("out of hue selection");
  }.bind(this));
}

Controller = function(heart) {
  this.heart = heart;

  this.panic = Panic(heart, 2, 13);

  this.hue = Hue(heart, 4);
}

five.Board().on("ready", function() {
  var heart = new Heart();
  var controller = new Controller(heart);

  this.repl.inject({
    heart: heart
  });


  /*
  var button = new five.Button({pin: 2, holdtime:1000});
  button.on("down", function() {
    heart.beat();
  });

  var interval = null;
  button.on("hold", function () {
    heart.beat();
    interval = setInterval(heart.beat.bind(heart), 1000);
  });

  button.on("up", function () {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  });
  */

});

