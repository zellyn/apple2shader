"use strict";

const screenEmu = (function () {
  // From AppleIIVideo.cpp

  const HORIZ_START = 16;
  const HORIZ_BLANK = (9 + HORIZ_START) // 25;
  const HORIZ_DISPLAY = 40;
  const HORIZ_TOTAL = (HORIZ_BLANK + HORIZ_DISPLAY) // 65;

  const CELL_WIDTH = 14;
  const CELL_HEIGHT = 8;

  const VERT_NTSC_START = 38;
  const VERT_PAL_START = 48;
  const VERT_DISPLAY = 192;

  const BLOCK_WIDTH = HORIZ_DISPLAY; // 40
  const BLOCK_HEIGHT = (VERT_DISPLAY / CELL_HEIGHT); // 24

  // From CanvasInterface.h

  const NTSC_FSC     = 315/88 * 1e6;         // 3579545 = 3.5 Mhz: Color Subcarrier
  const NTSC_4FSC    = 4 * NTSC_FSC;         // 14318180 = 14.3 Mhz
  const NTSC_HTOTAL  = (63+5/9) * 1e-6;
  const NTSC_HLENGTH = (52+8/9) * 1e-6;
  const NTSC_HHALF   = (35+2/3) * 1e-6;
  const NTSC_HSTART  = NTSC_HHALF - NTSC_HLENGTH/2;
  const NTSC_HEND    = NTSC_HHALF + NTSC_HLENGTH/2;
  const NTSC_VTOTAL  = 262;
  const NTSC_VLENGTH = 240;
  const NTSC_VSTART  = 19;
  const NTSC_VEND    = NTSC_VSTART + NTSC_VLENGTH;

  const PAL_FSC      = 4433618.75; // Color subcarrier
  const PAL_4FSC     = 4 * PAL_FSC;
  const PAL_HTOTAL   = 64e-6;
  const PAL_HLENGTH  = 52e-6;
  const PAL_HHALF    = (37+10/27) * 1e-6;
  const PAL_HSTART   = PAL_HHALF - PAL_HLENGTH / 2;
  const PAL_HEND     = PAL_HHALF + PAL_HLENGTH / 2;
  const PAL_VTOTAL   = 312;
  const PAL_VLENGTH  = 288;
  const PAL_VSTART   = 21;
  const PAL_VEND     = PAL_VSTART + PAL_VLENGTH;

  // From OpenGLCanvas.cpp
  const NTSC_I_CUTOFF = 1300000;
  const NTSC_Q_CUTOFF = 600000;
  const NTSC_IQ_DELTA = NTSC_I_CUTOFF - NTSC_Q_CUTOFF;

  // From AppleIIVideo::updateTiming
  const ntscClockFrequency = NTSC_4FSC * HORIZ_TOTAL / 912;
  const ntscVisibleRect = [[ntscClockFrequency * NTSC_HSTART, NTSC_VSTART],
			 [ntscClockFrequency * NTSC_HLENGTH, NTSC_VLENGTH]];
  const ntscDisplayRect = [[HORIZ_START, VERT_NTSC_START],
			 [HORIZ_DISPLAY, VERT_DISPLAY]];
  const ntscVertTotal = NTSC_VTOTAL;

  const palClockFrequency = 14250450.0 * HORIZ_TOTAL / 912;
  const palVisibleRect = [[palClockFrequency * PAL_HSTART, PAL_VSTART],
			[palClockFrequency * PAL_HLENGTH, PAL_VLENGTH]];
  const palDisplayRect = [[HORIZ_START, VERT_PAL_START],
			[HORIZ_DISPLAY, VERT_DISPLAY]];
  const palVertTotal = PAL_VTOTAL;

  const VERTEX_SHADER =`
// an attribute will receive data from a buffer
attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

// all shaders have a main function
void main() {
  // gl_Position is a special variable a vertex shader
  // is responsible for setting
  gl_Position = a_position;
  v_texCoord = a_texCoord;
}
`;

  const COMPOSITE_SHADER = `
precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D texture;
uniform vec2 textureSize;
uniform float subcarrier;
uniform sampler2D phaseInfo;
uniform vec3 c0, c1, c2, c3, c4, c5, c6, c7, c8;
uniform mat3 decoderMatrix;
uniform vec3 decoderOffset;

float PI = 3.14159265358979323846264;

vec3 pixel(in vec2 q)
{
  vec3 c = texture2D(texture, q).rgb;
  vec2 p = texture2D(phaseInfo, vec2(0, q.y)).rg;
  float phase = 2.0 * PI * (subcarrier * textureSize.x * q.x + p.x);
  return c * vec3(1.0, sin(phase), (1.0 - 2.0 * p.y) * cos(phase));
}

vec3 pixels(vec2 q, float i)
{
  return pixel(vec2(q.x + i, q.y)) + pixel(vec2(q.x - i, q.y));
}

void main(void)
{
  vec2 q = v_texCoord;
  vec3 c = pixel(q) * c0;
  c += pixels(q, 1.0 / textureSize.x) * c1;
  c += pixels(q, 2.0 / textureSize.x) * c2;
  c += pixels(q, 3.0 / textureSize.x) * c3;
  c += pixels(q, 4.0 / textureSize.x) * c4;
  c += pixels(q, 5.0 / textureSize.x) * c5;
  c += pixels(q, 6.0 / textureSize.x) * c6;
  c += pixels(q, 7.0 / textureSize.x) * c7;
  c += pixels(q, 8.0 / textureSize.x) * c8;
  gl_FragColor = vec4(decoderMatrix * c + decoderOffset, 1.0);
}
`;

  const DISPLAY_SHADER = `
precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D texture;
uniform vec2 textureSize;
uniform float barrel;
uniform vec2 barrelSize;
uniform float scanlineLevel;
uniform sampler2D shadowMask;
uniform vec2 shadowMaskSize;
uniform float shadowMaskLevel;
uniform float centerLighting;
uniform sampler2D persistence;
uniform vec2 persistenceSize;
uniform vec2 persistenceOrigin;
uniform float persistenceLevel;
uniform float luminanceGain;

float PI = 3.14159265358979323846264;

void main(void)
{
  vec2 qc = (v_texCoord - vec2(0.5, 0.5)) * barrelSize;
  vec2 qb = barrel * qc * dot(qc, qc);
  vec2 q = v_texCoord + qb;

  vec3 c = texture2D(texture, q).rgb;

  float scanline = sin(PI * textureSize.y * q.y);
  c *= mix(1.0, scanline * scanline, scanlineLevel);

  vec3 mask = texture2D(shadowMask, (v_texCoord + qb) * shadowMaskSize).rgb;
  c *= mix(vec3(1.0, 1.0, 1.0), mask, shadowMaskLevel);

  vec2 lighting = qc * centerLighting;
  c *= exp(-dot(lighting, lighting));

  c *= luminanceGain;

  vec2 qp = v_texCoord * persistenceSize + persistenceOrigin;
  c = max(c, texture2D(persistence, qp).rgb * persistenceLevel - 0.5 / 256.0);

  gl_FragColor = vec4(c, 1.0);
}
`;

  const RGB_SHADER = `
precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D texture;
uniform vec2 textureSize;
uniform vec3 c0, c1, c2, c3, c4, c5, c6, c7, c8;
uniform mat3 decoderMatrix;
uniform vec3 decoderOffset;

vec3 pixel(vec2 q)
{
  return texture2D(texture, q).rgb;
}

vec3 pixels(in vec2 q, in float i)
{
  return pixel(vec2(q.x + i, q.y)) + pixel(vec2(q.x - i, q.y));
}

void main(void)
{
  vec2 q = v_texCoord;
  vec3 c = pixel(q) * c0;
  c += pixels(q, 1.0 / textureSize.x) * c1;
  c += pixels(q, 2.0 / textureSize.x) * c2;
  c += pixels(q, 3.0 / textureSize.x) * c3;
  c += pixels(q, 4.0 / textureSize.x) * c4;
  c += pixels(q, 5.0 / textureSize.x) * c5;
  c += pixels(q, 6.0 / textureSize.x) * c6;
  c += pixels(q, 7.0 / textureSize.x) * c7;
  c += pixels(q, 8.0 / textureSize.x) * c8;
  gl_FragColor = vec4(decoderMatrix * c + decoderOffset, 1.0);
}
`;

  function buildTiming(clockFrequency, displayRect, visibleRect, vertTotal) {
    const vertStart = displayRect[0][1];
    // Total number of CPU cycles per frame: 17030 for NTSC.
    const frameCycleNum = HORIZ_TOTAL * vertTotal;
    // first displayed column.
    const horizStart = Math.floor(displayRect[0][0]);
    // imageSize is [14 * visible rect width in cells, visible lines]
    const imageSize = [Math.floor(CELL_WIDTH * visibleRect[1][0]),
		     Math.floor(visibleRect[1][1])];
    // imageLeft is # of pixels from first visible point to first displayed point.
    const imageLeft = Math.floor((horizStart-visibleRect[0][0]) * CELL_WIDTH);
    const colorBurst = [2 * Math.PI * (-33/360 + (imageLeft % 4) / 4)];
    const cycleNum = frameCycleNum + 16;

    // First pixel that OpenEmulator draws when painting normally.
    const topLeft = [imageLeft, vertStart - visibleRect[0][1]];
    // First pixel that OpenEmulator draws when painting 80-column mode.
    const topLeft80Col = [imageLeft - CELL_WIDTH/2, vertStart - visibleRect[0][1]];

    return {
      clockFrequency: clockFrequency,
      displayRect: displayRect,
      visibleRect: visibleRect,
      vertStart: vertStart,
      vertTotal: vertTotal,
      frameCycleNum: frameCycleNum,
      horizStart: horizStart,
      imageSize: imageSize,
      imageLeft: imageLeft,
      colorBurst: colorBurst,
      cycleNum: cycleNum,
      topLeft: topLeft,
      topLeft80Col: topLeft80Col,
    };
  }


  const Vector = class {
    constructor(n) {
      this.data = new Float32Array(n);
    }

    // Normalize the vector.
    normalize() {
      const vec = this.data;
      let sum = 0;
      for (const item of vec) {
	sum += item;
      }
      const gain = 1/sum;
      for (const i in vec) {
	vec[i] *= gain;
      }
      return this;
    }

    // Multiply this Vector by another, or by a number.
    mul(other) {
      const w = new Vector(0);
      if ((typeof other != "number") && (this.data.length != other.data.length)) {
	return w;
      }

      w.data = new Float32Array(this.data);

      for (let i = 0; i < w.data.length; i++) {
	if (typeof other == "number") {
	  w.data[i] *= other;
	} else {
	  w.data[i] *= other.data[i];
	}
      }

      return w;
    }

    realIDFT() {
      const size = this.data.length;
      const w = new Vector(size);
      for (let i = 0; i < size; i++) {
	const omega = 2 * Math.PI * i / size;

	for (let j = 0; j < size; j++) {
	  w.data[i] += this.data[j] * Math.cos(j * omega);
	}
      }

      for (let i = 0; i < size; i++) {
	w.data[i] /= size;
      }

      return w;
    }

    resize(n) {
      const newData = new Float32Array(n);
      for (let i=0; i < Math.min(newData.length, this.data.length); i++) {
	newData[i] = this.data[i];
      }
      this.data = newData;
      return this;
    }

    // Chebyshev Window
    //
    // Based on ideas at:
    // http://www.dsprelated.com/showarticle/42.php
    //
    static chebyshevWindow(n, sidelobeDb) {
      const m = n - 1;
      let w = new Vector(m);

      const alpha = Math.cosh(Math.acosh(Math.pow(10, sidelobeDb / 20)) / m);
      for (let i = 0; i < m; i++) {
      	const a = Math.abs(alpha * Math.cos(Math.PI * i / m));
      	if (a > 1)
      	  w.data[i] = Math.pow(-1, i) * Math.cosh(m * Math.acosh(a));
      	else
      	  w.data[i] = Math.pow(-1, i) * Math.cos(m * Math.acos(a));
      }

      w = w.realIDFT();

      w.resize(n);
      w.data[0] /= 2;
      w.data[n-1] = w.data[0];

      const max = w.data.reduce((prev, cur) => Math.max(prev, Math.abs(cur)));
      for (const i in w.data) {
      	w.data[i] /= max;
      }

      return w;
    }

    // Lanczos Window
    static lanczosWindow(n, fc) {
      let v = new Vector(n);
      fc = Math.min(fc, 0.5);
      const halfN = Math.floor(n / 2);

      for (let i = 0; i < n; i++) {
	const x = 2 * Math.PI * fc * (i - halfN);

	v.data[i] = (x == 0.0) ? 1.0 : Math.sin(x) / x;
      }

      return v;
    }

  };

  const Matrix3 = class {
    constructor(c00, c01, c02,
		c10, c11, c12,
		c20, c21, c22) {
      this.data = new Float32Array([c00, c01, c02, c10, c11, c12, c20, c21, c22]);
    }

    at(i, j) {
      return this.data[3 * i + j];
    }

    mul(val) {
      const m = new Matrix3(0,0,0,0,0,0,0,0,0);
      if (typeof val == "number") {
	m.data = m.data.map(x => x * val);
      } else {
	for (let i = 0; i < 3; i++) {
	  for (let j = 0; j < 3; j++) {
	    for (let k = 0; k < 3; k++) {
	      m.data[i * 3 + j] += val.data[i * 3 + k] * this.data[k * 3 + j];
	    }
	  }
	}
      }
      return m;
    }
  }

  // https://codereview.stackexchange.com/a/128619
  const loadImage = path =>
	new Promise((resolve, reject) => {
	  const img = new Image();
	  img.onload = () => resolve(img);
	  img.onerror = () => reject(`error loading '${path}'`);
	  img.src = path;
	});

  // Given an image that's 560x192, render it into the larger space
  // required for NTSC or PAL.
  // image: a 560x192 image, from the same domain (hence readable).
  // details: NTSC_DETAILS, or PAL_DETAILS
  // returns: a canvas
  const screenData = (image, details) => {
    if ((image.naturalWidth != 560) || (image.naturalHeight != 192)) {
      throw new Error('screenData expects an image 560x192;' +
		      ` got ${image.naturalWidth}x${image.naturalHeight}`);
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const width = details.imageSize[0];
    const height = details.imageSize[1];
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = 'rgba(0,0,0,1)';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, details.topLeft80Col[0], details.topLeft80Col[1]);
    // const myData = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
    return canvas;
  };

  const TEXTURE_NAMES = [
    "SHADOWMASK_TRIAD",
    "SHADOWMASK_INLINE",
    "SHADOWMASK_APERTURE",
    "SHADOWMASK_LCD",
    "SHADOWMASK_BAYER",
    "IMAGE_PHASEINFO",
    "IMAGE_IN",
    "IMAGE_DECODED",
    "IMAGE_PERSISTENCE",
  ];

  const SHADER_NAMES = [
    "COMPOSITE",
    "DISPLAY",
    "RGB",
  ];

  const resizeCanvas = (canvas) => {
    // Lookup the size the browser is displaying the canvas.
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    // Check if the canvas is not the same size.
    if (canvas.width != displayWidth ||
        canvas.height != displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
  };

  // Code from:
  // https://webglfundamentals.org/webgl/lessons/webgl-fundamentals.html
  const createShader = (gl, name, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
      return shader;
    }

    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`unable to compile shader ${name}: \n${log}`);
  };

  // Code from:
  // https://webglfundamentals.org/webgl/lessons/webgl-fundamentals.html
  const createProgram = (gl, name, ...shaders) => {
    const program = gl.createProgram();
    for (let shader of shaders) {
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
      return program;
    }
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`unable to compile program ${name}: \n${log}`);
  };

  const TextureInfo = class {
    constructor(width, height, glTexture) {
      this.width = width;
      this.height = height;
      this.glTexture = glTexture;
    }
  };

  const DisplayConfiguration = class {
    constructor() {
      this.videoDecoder = "CANVAS_RGB";
      this.videoBrightness = 0;
      this.videoContrast = 1;
      this.videoSaturation = 1;
      this.videoHue = 0;
      this.videoCenter = [0,0];
      this.videoSize = [1,1];
      this.videoBandwidth = 14318180;
      this.videoLumaBandwidth = 600000;
      this.videoChromaBandwidth = 2000000;
      this.videoWhiteOnly = false;

      this.displayResolution = [640, 480];
      this.displayPixelDensity = 72;
      this.displayBarrel = 0;
      this.displayScanlineLevel = 0;
      this.displayShadowMaskLevel = 0;
      this.displayShadowMaskDotPitch = 1;
      this.displayShadowMask = "SHADOWMASK_TRIAD";
      this.displayPersistence = 0;
      this.displayCenterLighting = 1;
      this.displayLuminanceGain = 1;
    }
  };

  // Corresponds to OEImage. Contains the data on an NTSC/PAL/whatever
  // image. The `data` field is an ImageData object with the actual
  // image data.
  const ImageInfo = class {
    constructor(sampleRate, blackLevel, whiteLevel, subCarrier, colorBurst,
		phaseAlternation, data) {
      if (typeof data != "object") {
	throw new Error(`want typeof data == 'object'; got '${typeof data}'`);
      }
      if (!(data instanceof ImageData)) {
	throw new Error(`want data instanceof ImageData; got '${data.constructor.name}'`);
      }
      this.sampleRate = sampleRate;
      this.blackLevel = blackLevel;
      this.whiteLevel = whiteLevel;
      this.subCarrier = subCarrier;
      this.colorBurst = colorBurst;
      this.phaseAlternation = phaseAlternation;
      this.data = data;
    }

    get width() {
      return this.data.width;
    }

    get height() {
      return this.data.height;
    }
  };

  const ScreenView = class {
    constructor(gl) {
      const float_texture_ext = gl.getExtension('OES_texture_float');
      if (float_texture_ext == null) {
	throw new Error("WebGL extension 'OES_texture_float' unavailable");
      }

      this.gl = gl;
      this.textures = {};
      this.shaders = {};
      this.image = null;
      this.display = null;
      this.configurationChanged = true;
      this.imageChanged = true;
      this.imageSampleRate = null;
      this.imageBlackLevel = null;
      this.imageWhiteLevel = null;
      this.imageSubcarrier = null;
    }

    get image() {
      return this._image
    }

    set image(image) {
      this._image = image;
      this.imageChanged = true;
    }

    set displayConfiguration(displayConfiguration) {
      this.display = displayConfiguration;
      this.configurationChanged = true;
    }

    async initOpenGL() {
      const gl = this.gl;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.textures = {};

      for (let name of TEXTURE_NAMES) {
	this.textures[name] = new TextureInfo(0, 0, gl.createTexture());
      }

      await this.loadTextures();

      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

      this.loadShaders();
    }

    freeOpenGL() {
      const gl = this.gl;

      for (let name of TEXTURE_NAMES) {
	gl.deleteTexture(this.textures[name].glTexture);
      }

      this.deleteShaders();
    }

    loadTextures() {
      return Promise.all([
	this.loadTexture("textures/Shadow Mask Triad.png", true, "SHADOWMASK_TRIAD"),
	this.loadTexture("textures/Shadow Mask Inline.png", true, "SHADOWMASK_INLINE"),
	this.loadTexture("textures/Shadow Mask Aperture.png", true, "SHADOWMASK_APERTURE"),
	this.loadTexture("textures/Shadow Mask LCD.png", true, "SHADOWMASK_LCD"),
	this.loadTexture("textures/Shadow Mask Bayer.png", true, "SHADOWMASK_BAYER"),
      ]);
    }

    async loadTexture(path, isMipMap, name) {
      const gl = this.gl;
      const texInfo = this.textures[name];
      const image = await loadImage(path);
      gl.bindTexture(gl.TEXTURE_2D, texInfo.glTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
		    gl.RGBA, gl.UNSIGNED_BYTE, image);
      if (isMipMap) {
	gl.generateMipmap(gl.TEXTURE_2D);
      }

      texInfo.width = image.naturalWidth;
      texInfo.height = image.naturalHeight;
    }

    loadShaders() {
      this.loadShader("COMPOSITE", COMPOSITE_SHADER);
      this.loadShader("DISPLAY", DISPLAY_SHADER);
      this.loadShader("RGB", RGB_SHADER);
    }

    loadShader(name, source) {
      const glVertexShader = createShader(this.gl, name, this.gl.VERTEX_SHADER, VERTEX_SHADER);
      const glFragmentShader = createShader(this.gl, name, this.gl.FRAGMENT_SHADER, source);
      const glProgram = createProgram(this.gl, name, glVertexShader, glFragmentShader);
      this.gl.deleteShader(glVertexShader);
      this.gl.deleteShader(glFragmentShader);
      this.shaders[name] = glProgram;
    }

    deleteShaders() {
      for (let name of SHADER_NAMES) {
	if (this.shaders[name]) {
	  this.gl.deleteProgram(this.shaders[name]);
	  this.shaders[name] = false;
	}
      }
    }

    vsync() {
      // if viewport size has changed:
      // glViewPort(0, 0, new_width, new_height);

      if (this.imageChanged) {
	this.uploadImage();
      }

      if (this.configurationChanged) {
	this.configureShaders();
      }

      if (this.imageChanged || this.configurationChanged) {
	this.renderImage();
      }

      if (this.imageChanged || this.configurationChanged ||
	  this.image.displayPersistence != 0) {
	this.drawDisplayCanvas();
      }
    }

    uploadImage() {
      const gl = this.gl;
      const image = this.image;

      this.resizeTexture("IMAGE_IN", image.width, image.height);
      const texInfoImage = this.textures["IMAGE_IN"];
      gl.bindTexture(gl.TEXTURE_2D, texInfoImage.glTexture);
      const format = gl.LUMINANCE;
      const type = gl.UNSIGNED_BYTE;
      gl.texSubImage2D(gl.TEXTURE_2D, 0,
      		       0, 0, // xoffset, yoffset
      		       format, type, image.data);

      // Update configuration
      if ((image.sampleRate != this.imageSampleRate) ||
          (image.blackLevel != this.imageBlackLevel) ||
          (image.whiteLevel != this.imageWhiteLevel) ||
          (image.subcarrier != this.imageSubcarrier))
      {
        this.imageSampleRate = image.sampleRate;
        this.imageBlackLevel = image.blackLevel;
        this.imageWhiteLevel = image.whiteLevel;
        this.imageSubcarrier = image.subcarrier;

        this.configurationChanged = true;
      }

      // Upload phase info
      const texHeight = 2**Math.ceil(Math.log2(image.height));
      const colorBurst = image.colorBurst
      const phaseAlternation = image.phaseAlternation;

      const phaseInfo = new Float32Array(3 * texHeight);

      for (let x = 0; x < image.height; x++) {
	const c = colorBurst[x % colorBurst.length] / 2 / Math.PI;
	phaseInfo[3 * x + 0] = c - Math.floor(c);
	phaseInfo[3 * x + 1] = phaseAlternation[x % phaseAlternation.length];
      }

      const texInfoPhase = this.textures["IMAGE_PHASEINFO"];
      gl.bindTexture(gl.TEXTURE_2D, texInfoPhase.glTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, texHeight, 0,
		    gl.RGB, gl.FLOAT, phaseInfo);
    }

    getRenderShader() {
      switch (this.display.videoDecoder) {
      case "CANVAS_RGB":
      case "CANVAS_MONOCHROME":
	return [this.shaders["RGB"], "RGB"];
      case "CANVAS_YUV":
      case "CANVAS_YIQ":
      case "CANVAS_CXA2025AS":
	return [this.shaders["COMPOSITE"], "COMPOSITE"];
      }
      return [null, null];
    }

    configureShaders() {
      const gl = this.gl;

      const [renderShader, renderShaderName] = this.getRenderShader();
      const displayShader = this.shaders["DISPLAY"];

      if (!renderShader || !displayShader)
	return;

      const isCompositeDecoder = (renderShaderName == "RGB");

      // Render shader
      gl.useProgram(renderShader);

      // Subcarrier
      if (isCompositeDecoder) {
	gl.uniform1f(gl.getUniformLocation(renderShader, "subcarrier"),
		     this.imageSubcarrier / this.imageSampleRate);
      }

      // Filters
      const w = Vector.chebyshevWindow(17, 50).normalize();

      let wy, wu, wv;

      const bandwidth = this.display.videoBandwidth / this.imageSampleRate;

      if (isCompositeDecoder) {
	let yBandwidth = this.display.videoLumaBandwidth / this.imageSampleRate;
	let uBandwidth = this.display.videoChromaBandwidth / this.imageSampleRate;
	let vBandwidth = uBandwidth;

	if (this.display.videoDecoder == "CANVAS_YIQ")
	  uBandwidth = uBandwidth + NTSC_IQ_DELTA / this.imageSampleRate;

        // Switch to video bandwidth when no subcarrier
        if ((this.imageSubcarrier == 0.0) || this.display.videoWhiteOnly)
        {
            yBandwidth = bandwidth;
            uBandwidth = bandwidth;
            vBandwidth = bandwidth;
        }

        wy = w.mul(Vector.lanczosWindow(17, yBandwidth));
        wy = wy.normalize();

        wu = w.mul(Vector.lanczosWindow(17, uBandwidth));
        wu = wu.normalize().mul(2);

        wv = w.mul(Vector.lanczosWindow(17, vBandwidth));
        wv = wv.normalize().mul(2);
      } else {
        wy = w.mul(Vector.lanczosWindow(17, bandwidth));
        wu = wv = wy = wy.normalize();
      }

      gl.uniform3f(gl.getUniformLocation(renderShader, "c0"),
		   wy.data[8], wu.data[8], wv.data[8]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c1"),
		   wy.data[7], wu.data[7], wv.data[7]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c2"),
		   wy.data[6], wu.data[6], wv.data[6]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c3"),
		   wy.data[5], wu.data[5], wv.data[5]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c4"),
		   wy.data[4], wu.data[4], wv.data[4]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c5"),
		   wy.data[3], wu.data[3], wv.data[3]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c6"),
		   wy.data[2], wu.data[2], wv.data[2]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c7"),
		   wy.data[1], wu.data[1], wv.data[1]);
      gl.uniform3f(gl.getUniformLocation(renderShader, "c8"),
		   wy.data[0], wu.data[0], wv.data[0]);

      // Decoder matrix
      let decoderMatrix = new Matrix3(1, 0, 0,
				      0, 1, 0,
				      0, 0, 1);

      // Encode
      if (!isCompositeDecoder) {
        // Y'PbPr encoding matrix
        decoderMatrix = new Matrix3(0.299, -0.168736, 0.5,
                                    0.587, -0.331264, -0.418688,
                                    0.114, 0.5, -0.081312).mul(decoderMatrix);
      }

      // Set hue
      if (this.display.videoDecoder == "CANVAS_MONOCHROME")
        decoderMatrix = new Matrix3(1, 0.5, 0,
                                    0, 0, 0,
                                    0, 0, 0).mul(decoderMatrix);

      // Disable color decoding when no subcarrier
      if (isCompositeDecoder)
      {
        if ((this.imageSubcarrier == 0.0) || this.display.videoWhiteOnly) {
          decoderMatrix = new Matrix3(1, 0, 0,
                                      0, 0, 0,
                                      0, 0, 0).mul(decoderMatrix);
        }
      }

      // Saturation
      decoderMatrix = new Matrix3(1, 0, 0,
				  0, this.display.videoSaturation, 0,
				  0, 0, this.display.videoSaturation).mul(decoderMatrix);

      // Hue
      const hue = 2 * Math.PI * this.display.videoHue;

      decoderMatrix = new Matrix3(1, 0, 0,
				  0, Math.cos(hue), -Math.sin(hue),
				  0, Math.sin(hue), Math.cos(hue)).mul(decoderMatrix);

      // Decode
      switch (this.display.videoDecoder) {
      case "CANVAS_RGB":
      case "CANVAS_MONOCHROME":
        // Y'PbPr decoder matrix
        decoderMatrix = new Matrix3(1, 1, 1,
                                    0, -0.344136, 1.772,
                                    1.402, -0.714136, 0).mul(decoderMatrix);
        break;

      case "CANVAS_YUV":
      case "CANVAS_YIQ":
        // Y'UV decoder matrix
        decoderMatrix = new Matrix3(1, 1, 1,
                                    0, -0.394642, 2.032062,
                                    1.139883, -0.580622, 0).mul(decoderMatrix);
        break;

      case "CANVAS_CXA2025AS":
        // Exchange I and Q
        decoderMatrix = new Matrix3(1, 0, 0,
                                    0, 0, 1,
                                    0, 1, 0).mul(decoderMatrix);

        // Rotate 33 degrees
        hue = -Math.PI * 33 / 180;
        decoderMatrix = new Matrix3(1, 0, 0,
                                    0, Math.cos(hue), -Math.sin(hue),
                                    0, Math.sin(hue), Math.cos(hue)).mul(decoderMatrix);

        // CXA2025AS decoder matrix
        decoderMatrix = new Matrix3(1, 1, 1,
                                    1.630, -0.378, -1.089,
                                    0.317, -0.466, 1.677).mul(decoderMatrix);
        break;
      default:
	throw new Error(`unknown videoDecoder: ${this.display.videoDecoder}`);
      }

      // Brightness
      const brightness = this.display.videoBrightness - this.imageBlackLevel;
      let decoderOffset;

      if (isCompositeDecoder)
        decoderOffset = decoderMatrix.mul(new Matrix3(brightness, 0, 0,
                                                      0, 0, 0,
                                                      0, 0, 0));
      else
        decoderOffset = decoderMatrix.mul(new Matrix3(brightness, 0, 0,
                                                      brightness, 0, 0,
                                                      brightness, 0, 0));

      gl.uniform3f(gl.getUniformLocation(renderShader, "decoderOffset"),
                   decoderOffset.at(0, 0),
                   decoderOffset.at(0, 1),
                   decoderOffset.at(0, 2));

      // Contrast
      let contrast = this.display.videoContrast;

      const videoLevel = (this.imageWhiteLevel - this.imageBlackLevel);
      if (videoLevel > 0)
        contrast /= videoLevel;
      else
        contrast = 0;

      if (contrast < 0)
        contrast = 0;

      decoderMatrix = decoderMatrix.mul(contrast);

      gl.uniformMatrix3fv(gl.getUniformLocation(renderShader, "decoderMatrix"),
			  false, decoderMatrix.data);

      // Display shader
      gl.useProgram(displayShader);

      // Barrel
      gl.uniform1f(gl.getUniformLocation(displayShader, "barrel"),
                   this.display.displayBarrel);

      // Shadow mask
      gl.uniform1i(gl.getUniformLocation(displayShader, "shadowMask"), 1);
      gl.uniform1f(gl.getUniformLocation(displayShader, "shadowMaskLevel"),
                   this.display.displayShadowMaskLevel);

      // Persistence
      const frameRate = 60;

      gl.uniform1f(gl.getUniformLocation(displayShader, "persistenceLevel"),
                   this.display.displayPersistence /
                   (1.0 / frameRate + this.display.displayPersistence));

      if (this.display.displayPersistence == 0)
        this.resizeTexture("IMAGE_PERSISTENCE", 0, 0);

      // Center lighting
      let centerLighting = this.display.displayCenterLighting;
      if (Math.abs(centerLighting) < 0.001)
        centerLighting = 0.001;
      gl.uniform1f(gl.getUniformLocation(displayShader, "centerLighting"),
                   1.0 / centerLighting - 1);

      // Luminance gain
      gl.uniform1f(gl.getUniformLocation(displayShader, "luminanceGain"),
                   this.display.displayLuminanceGain);
    }

    // TODO(zellyn): implement
    renderImage() {
    }

    // TODO(zellyn): implement
    drawDisplayCanvas() {
    }

    // Resize the texture with the given name to the next
    // highest power of two width and height. Wouldn't be
    // necessary with webgl2.
    resizeTexture(name, width, height) {
      const gl = this.gl;
      const texInfo = this.textures[name];
      if (!texInfo) {
	throw new Error(`Cannot find texture named ${name}`);
      }
      if (width < 4) width = 4;
      if (height < 4) height = 4;
      width = 2**Math.ceil(Math.log2(width));
      height = 2**Math.ceil(Math.log2(height));
      if (texInfo.width != width || texInfo.height != height) {
	texInfo.width = width;
	texInfo.height = height;
	gl.bindTexture(gl.TEXTURE_2D, texInfo.glTexture);
	const dummy = new Uint8Array(width * height);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0,
		      gl.LUMINANCE, gl.UNSIGNED_BYTE, dummy);
      }
    }
  }

  return {
    C: {
      HORIZ_START: HORIZ_START,
      HORIZ_BLANK: HORIZ_BLANK,
      HORIZ_DISPLAY: HORIZ_DISPLAY,
      HORIZ_TOTAL: HORIZ_TOTAL,
      CELL_WIDTH: CELL_WIDTH,
      CELL_HEIGHT: CELL_HEIGHT,
      VERT_NTSC_START: VERT_NTSC_START,
      VERT_PAL_START: VERT_PAL_START,
      VERT_DISPLAY: VERT_DISPLAY,
      BLOCK_WIDTH: BLOCK_WIDTH,
      BLOCK_HEIGHT: BLOCK_HEIGHT,
      NTSC_I_CUTOFF: NTSC_I_CUTOFF,
      NTSC_Q_CUTOFF: NTSC_Q_CUTOFF,
      NTSC_IQ_DELTA: NTSC_IQ_DELTA,
      NTSC_DETAILS: buildTiming(ntscClockFrequency, ntscDisplayRect,
				ntscVisibleRect, ntscVertTotal),
      PAL_DETAILS: buildTiming(palClockFrequency, palDisplayRect,
			       palVisibleRect, palVertTotal),
    },
    loadImage: loadImage,
    screenData: screenData,
    resizeCanvas: resizeCanvas,
    createShader: createShader,
    createProgram: createProgram,

    // Classes.
    ScreenView: ScreenView,
    DisplayConfiguration: DisplayConfiguration,
    ImageInfo: ImageInfo,
    Vector: Vector,
  };
})();
