var five = require("johnny-five"),
  keypress = require("keypress"),
  tinycolor = require("tinycolor2");

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
  this.beat_time = 600; // ms

  this.led = new five.Led.RGB(led_opts);
  this.setHue(0);
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


five.Board().on("ready", function() {

  // Initialize the RGB LED
  var heart = new Heart();


  // Add led to REPL (optional)
  this.repl.inject({
    heart: heart
  });

  heart.beat();

});

