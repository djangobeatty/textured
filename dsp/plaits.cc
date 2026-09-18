// NOODLERACK wrapper around the open-source Plaits DSP (MIT, © Émilie Gillet)
// Exposes the full hardware modulation matrix.
#include "plaits/dsp/voice.h"
#include "stmlib/utils/buffer_allocator.h"

using namespace plaits;

static Voice voice;
static Patch patch;
static Modulations modulations;
static char shared_buffer[32768];
static Voice::Frame frames[kMaxBlockSize];
static float out_buf[kMaxBlockSize];
static float aux_buf[kMaxBlockSize];

extern "C" {

void p_init() {
  stmlib::BufferAllocator allocator(shared_buffer, sizeof(shared_buffer));
  voice.Init(&allocator);
  patch.engine = 8;
  patch.note = 48.0f;
  patch.harmonics = 0.5f;
  patch.timbre = 0.5f;
  patch.morph = 0.5f;
  patch.frequency_modulation_amount = 0.0f;
  patch.timbre_modulation_amount = 0.0f;
  patch.morph_modulation_amount = 0.0f;
  patch.decay = 0.5f;
  patch.lpg_colour = 0.2f;
  modulations = Modulations();
}

float* p_out() { return out_buf; }
float* p_aux() { return aux_buf; }

void p_render(int engine, float note, float harmonics, float timbre,
              float morph, float decay, float lpg_colour,
              float fm_amount, float timbre_amount, float morph_amount,
              float m_engine, float m_note, float m_freq, float m_harm,
              float m_timbre, float m_morph, float m_level, float trigger,
              int flags, int size) {
  patch.engine = engine;
  patch.note = note;
  patch.harmonics = harmonics;
  patch.timbre = timbre;
  patch.morph = morph;
  patch.decay = decay;
  patch.lpg_colour = lpg_colour;
  patch.frequency_modulation_amount = fm_amount;
  patch.timbre_modulation_amount = timbre_amount;
  patch.morph_modulation_amount = morph_amount;

  modulations.engine = m_engine;
  modulations.note = m_note;
  modulations.frequency = m_freq;
  modulations.harmonics = m_harm;
  modulations.timbre = m_timbre;
  modulations.morph = m_morph;
  modulations.level = m_level;
  modulations.trigger = trigger;
  modulations.frequency_patched = (flags & 1) != 0;
  modulations.timbre_patched = (flags & 2) != 0;
  modulations.morph_patched = (flags & 4) != 0;
  modulations.trigger_patched = (flags & 8) != 0;
  modulations.level_patched = (flags & 16) != 0;

  if (size > (int)kMaxBlockSize) size = (int)kMaxBlockSize;
  voice.Render(patch, modulations, frames, (size_t)size);
  for (int i = 0; i < size; ++i) {
    out_buf[i] = frames[i].out / 32768.0f;
    aux_buf[i] = frames[i].aux / 32768.0f;
  }
}

}  // extern "C"
