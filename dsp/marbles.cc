// NOODLERACK wrapper around the open-source Marbles DSP (MIT, © Émilie Gillet)
// Exposes the T (random gates) and X/Y (random voltages) generators.
//
// Conventions:
// - Sample rate: 48000 Hz, block size 1..128 samples per m_render call.
// - t_rate_bpm: tempo of the internal master clock in BPM (120 == Marbles'
//   center position; internally converted to semitones around 2 Hz).
// - X/Y outputs are in Marbles volts, which are already 1.0 per octave
//   (scale base_interval == 1.0f), so they're passed through unscaled:
//   1.0 == one octave. NARROW range => 0..+2, POSITIVE => 0..+5,
//   FULL => -5..+5.
#include <cmath>

#include "marbles/random/random_generator.h"
#include "marbles/random/random_stream.h"
#include "marbles/random/t_generator.h"
#include "marbles/random/x_y_generator.h"
#include "stmlib/utils/gate_flags.h"

using namespace marbles;
using namespace stmlib;

static const int kMaxFrames = 128;

static RandomGenerator random_generator;
static RandomStream random_stream;
static TGenerator t_generator;
static XYGenerator xy_generator;

// I/O buffers exposed to JS.
static float clock_buf[kMaxFrames];   // input: external clock, 0/1 per sample
static float t1_buf[kMaxFrames];
static float t2_buf[kMaxFrames];
static float t3_buf[kMaxFrames];
static float x1_buf[kMaxFrames];
static float x2_buf[kMaxFrames];
static float x3_buf[kMaxFrames];
static float y_buf[kMaxFrames];

// Scratch buffers (same layout as the firmware main loop).
static float ramp_buffer[kMaxFrames * 4];
static bool gates[kMaxFrames * 2];
static float voltages[kMaxFrames * 4];
static GateFlags clock_flags[kMaxFrames];
static GateFlags previous_flags = GATE_FLAG_LOW;

// The 6 default preset scales, copied from marbles/settings.cc.
static const Scale preset_scales[6] = {
  // C major
  {
    1.0f,
    12,
    {
      { 0.0000f, 255 },  // C
      { 0.0833f, 16 },   // C#
      { 0.1667f, 96 },   // D
      { 0.2500f, 24 },   // D#
      { 0.3333f, 128 },  // E
      { 0.4167f, 64 },   // F
      { 0.5000f, 8 },    // F#
      { 0.5833f, 192 },  // G
      { 0.6667f, 16 },   // G#
      { 0.7500f, 96 },   // A
      { 0.8333f, 24 },   // A#
      { 0.9167f, 128 },  // B
    }
  },

  // C minor
  {
    1.0f,
    12,
    {
      { 0.0000f, 255 },  // C
      { 0.0833f, 16 },   // C#
      { 0.1667f, 96 },   // D
      { 0.2500f, 128 },  // Eb
      { 0.3333f, 8 },    // E
      { 0.4167f, 64 },   // F
      { 0.5000f, 4 },    // F#
      { 0.5833f, 192 },  // G
      { 0.6667f, 96 },   // G#
      { 0.7500f, 16 },   // A
      { 0.8333f, 128 },  // Bb
      { 0.9167f, 16 },   // B
    }
  },

  // Pentatonic
  {
    1.0f,
    12,
    {
      { 0.0000f, 255 },  // C
      { 0.0833f, 4 },    // C#
      { 0.1667f, 96 },   // D
      { 0.2500f, 4 },    // Eb
      { 0.3333f, 4 },    // E
      { 0.4167f, 140 },  // F
      { 0.5000f, 4 },    // F#
      { 0.5833f, 192 },  // G
      { 0.6667f, 4 },    // G#
      { 0.7500f, 96 },   // A
      { 0.8333f, 4 },    // Bb
      { 0.9167f, 4 },    // B
    }
  },

  // Pelog
  {
    1.0f,
    7,
    {
      { 0.0000f, 255 },  // C
      { 0.1275f, 128 },  // Db+
      { 0.2625f, 32 },   // Eb-
      { 0.4600f, 8 },    // F#-
      { 0.5883f, 192 },  // G
      { 0.7067f, 64 },   // Ab
      { 0.8817f, 16 },   // Bb+
    }
  },

  // Raag Bhairav That
  {
    1.0f,
    12,
    {
      { 0.0000f, 255 }, // ** Sa
      { 0.0752f, 128 }, // ** Komal Re
      { 0.1699f, 4 },   //    Re
      { 0.2630f, 4 },   //    Komal Ga
      { 0.3219f, 128 }, // ** Ga
      { 0.4150f, 64 },  // ** Ma
      { 0.4918f, 4 },   //    Tivre Ma
      { 0.5850f, 192 }, // ** Pa
      { 0.6601f, 64 },  // ** Komal Dha
      { 0.7549f, 4 },   //    Dha
      { 0.8479f, 4 },   //    Komal Ni
      { 0.9069f, 64 },  // ** Ni
    }
  },

  // Raag Shri
  {
    1.0f,
    12,
    {
      { 0.0000f, 255 }, // ** Sa
      { 0.0752f, 4 },   //    Komal Re
      { 0.1699f, 128 }, // ** Re
      { 0.2630f, 64 },  // ** Komal Ga
      { 0.3219f, 4 },   //    Ga
      { 0.4150f, 128 }, // ** Ma
      { 0.4918f, 4 },   //    Tivre Ma
      { 0.5850f, 192 }, // ** Pa
      { 0.6601f, 4 },   //    Komal Dha
      { 0.7549f, 64 },  // ** Dha
      { 0.8479f, 128 }, // ** Komal Ni
      { 0.9069f, 4 },   //    Ni
    }
  },
};

extern "C" {

void m_init() {
  random_generator.Init(1);
  random_stream.Init(&random_generator);
  t_generator.Init(&random_stream, 48000.0f);
  xy_generator.Init(&random_stream, 48000.0f);
  for (int i = 0; i < 6; ++i) {
    xy_generator.LoadScale(i, preset_scales[i]);
  }
  previous_flags = GATE_FLAG_LOW;
}

float* m_clock() { return clock_buf; }
float* m_t1() { return t1_buf; }
float* m_t2() { return t2_buf; }
float* m_t3() { return t3_buf; }
float* m_x1() { return x1_buf; }
float* m_x2() { return x2_buf; }
float* m_x3() { return x3_buf; }
float* m_y() { return y_buf; }

void m_render(float t_rate_bpm, float t_bias, float t_jitter, int t_model,
              float deja_vu, int dv_length,
              float x_spread, float x_bias, float x_steps,
              int x_scale, int x_range,
              int use_ext_clock, int size) {
  if (size < 1) return;
  if (size > kMaxFrames) size = kMaxFrames;

  // Convert the external clock samples to edge-aware GateFlags.
  GateFlags flags = previous_flags;
  for (int i = 0; i < size; ++i) {
    flags = ExtractGateFlags(flags, clock_buf[i] > 0.5f);
    clock_flags[i] = flags;
  }
  previous_flags = flags;

  // Internal clock: rate is in semitones around 2 Hz (= 120 BPM) at RANGE_1X.
  if (t_rate_bpm < 1.0f) t_rate_bpm = 1.0f;
  float rate_semitones = 12.0f * log2f(t_rate_bpm / 120.0f);

  if (t_model < 0) t_model = 0;
  if (t_model > 6) t_model = 6;
  if (dv_length < 1) dv_length = 1;
  if (dv_length > 16) dv_length = 16;

  t_generator.set_model(static_cast<TGeneratorModel>(t_model));
  t_generator.set_range(T_GENERATOR_RANGE_1X);
  t_generator.set_rate(rate_semitones);
  t_generator.set_bias(t_bias);
  t_generator.set_jitter(t_jitter);
  t_generator.set_deja_vu(deja_vu);
  t_generator.set_length(dv_length);
  t_generator.set_pulse_width_mean(0.5f);
  t_generator.set_pulse_width_std(0.0f);

  Ramps ramps;
  ramps.master = &ramp_buffer[0];
  ramps.external = &ramp_buffer[kMaxFrames];
  ramps.slave[0] = &ramp_buffer[kMaxFrames * 2];
  ramps.slave[1] = &ramp_buffer[kMaxFrames * 3];

  t_generator.Process(
      use_ext_clock != 0, clock_flags, ramps, gates, (size_t)size);

  GroupSettings x;
  x.control_mode = CONTROL_MODE_IDENTICAL;
  x.voltage_range = static_cast<VoltageRange>(((x_range % 3) + 3) % 3);
  x.register_mode = false;
  x.register_value = 0.0f;
  x.spread = x_spread;
  x.bias = x_bias;
  x.steps = x_steps;
  x.deja_vu = deja_vu;
  x.scale_index = ((x_scale % 6) + 6) % 6;
  x.length = dv_length;
  x.ratio.p = 1;
  x.ratio.q = 1;

  GroupSettings y;
  y.control_mode = CONTROL_MODE_IDENTICAL;
  y.voltage_range = VOLTAGE_RANGE_FULL;
  y.register_mode = false;
  y.register_value = 0.0f;
  y.spread = 0.5f;
  y.bias = 0.5f;
  y.steps = 0.0f;
  y.deja_vu = 0.0f;
  y.scale_index = x.scale_index;
  y.length = 1;
  y.ratio.p = 1;   // firmware default y_divider = 128 -> 1/8 of the X clock
  y.ratio.q = 8;

  // X follows the T gates (hardware default: X1/X2/X3 clocked by t1/t2/t3).
  xy_generator.Process(
      CLOCK_SOURCE_INTERNAL_T1_T2_T3,
      x, y, clock_flags, ramps, voltages, (size_t)size);

  // Deinterleave. Like the firmware: t1/t3 come from the gates array
  // (kNumTChannels == 2), t2 is the master clock square; X1,X2,X3,Y are
  // interleaved with stride 4.
  const float* v = voltages;
  const bool* g = gates;
  for (int i = 0; i < size; ++i) {
    t1_buf[i] = *g++ ? 1.0f : 0.0f;
    t3_buf[i] = *g++ ? 1.0f : 0.0f;
    t2_buf[i] = ramps.master[i] < 0.5f ? 1.0f : 0.0f;
    x1_buf[i] = *v++;
    x2_buf[i] = *v++;
    x3_buf[i] = *v++;
    y_buf[i] = *v++;
  }
}

}  // extern "C"
