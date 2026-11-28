// "Forçar SDR": captura um monitor ou uma janela em HDR e converte para SDR na
// placa de vídeo, como o Parsec faz.
//
// Por que existe: o Chromium pede ao Windows a imagem já em 8 bits, e com o
// HDR ligado o Windows corta tudo acima de um certo brilho. Medido em
// 19/11/2026 no Odyssey do dono, com o FF7 em HDR: pelo caminho de hoje, tudo
// acima de ~66 nits chegava branco aos amigos. Aqui a imagem é pedida em 16
// bits (R16G16B16A16_FLOAT, scRGB linear, 1.0 = 80 nits), e os brilhos acima
// do branco do SDR são COMPRIMIDOS em vez de cortados.
//
// Dois jeitos de capturar, uma conversão só:
// - monitor: a duplicação de tela do DXGI (DuplicateOutput1). O cursor não
//   vem junto e é desenhado aqui, pela forma que ela entrega.
// - janela: o Windows Graphics Capture (WGC). Ele já desenha o cursor. A
//   janela muda de tamanho, então a imagem é encaixada na saída com faixas
//   pretas, sem esticar, como o Chromium faz.
//
// O quadro convertido sai numa textura compartilhada (NT handle), de um anel
// de 6, e o processo principal o entrega à página pelo `sharedTexture` do
// Electron, sem passar pixel pela CPU. A página devolve cada textura ao anel
// (liberar) assim que a copia.

#include <napi.h>
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_6.h>
#include <d3dcompiler.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using Relogio = std::chrono::steady_clock;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wdx = winrt::Windows::Graphics::DirectX;

namespace {

// A curva aprovada pelo dono comparando lado a lado, em 19/11/2026: até 60% do
// branco do SDR (já com o branco posto em 80%) a imagem não muda; acima disso
// os brilhos são comprimidos até o pico do monitor caber em 1.0. O pico é o do
// MONITOR, fixo: um pico calculado por quadro faria o brilho pulsar.
constexpr float JOELHO = 0.6f;
constexpr float BRANCO_NA_SAIDA = 0.8f;

// A página devolve cada textura assim que a copia (ver o preload), então quase
// sempre só uma ou duas estão fora. 6 dá folga para a página atrasar um pouco
// sem a captura ter que pular quadro.
constexpr int ANEL = 6;

// Imagem parada não gera quadro novo. Um de vez em quando avisa a quem
// assiste que a transmissão continua viva.
constexpr int REPETIR_PARADO_MS = 1000;

const char* SHADER = R"HLSL(
Texture2D<float4> entrada : register(t0);
Texture2D<float4> cursor : register(t1);
SamplerState amostrador : register(s0);
RWTexture2D<unorm float4> saida : register(u0);

cbuffer Parametros : register(b0) {
  float escala; float pico; float joelho; float alvo;
  uint conteudoW; uint conteudoH; uint texW; uint texH;
  uint saidaW; uint saidaH; uint regX; uint regY;
  uint regW; uint regH; uint cursorVisivel; uint direto;
  int cursorX; int cursorY; uint cursorW; uint cursorH;
};

float srgb(float v) {
  v = saturate(v);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

[numthreads(16, 16, 1)]
void main(uint3 id : SV_DispatchThreadID) {
  if (id.x >= saidaW || id.y >= saidaH) return;
  // Fora da região da imagem: as faixas pretas de quando a janela não tem a
  // proporção da saída.
  if (id.x < regX || id.y < regY || id.x >= regX + regW || id.y >= regY + regH) {
    saida[id.xy] = float4(0, 0, 0, 1);
    return;
  }
  // uvc: de 0 a 1 sobre a imagem; uvt: o mesmo ponto na textura, que pode ser
  // maior que a imagem (a janela encolheu).
  float2 uvc = (float2(id.xy - uint2(regX, regY)) + 0.5) / float2(regW, regH);
  float2 limite = (float2(conteudoW, conteudoH) - 0.5) / float2(texW, texH);
  float2 uvt = min(uvc * float2(conteudoW, conteudoH) / float2(texW, texH), limite);

  float3 s;
  if (direto != 0) {
    // Monitor sem HDR (a captura própria de janela): o quadro já vem em 8
    // bits, pronto. Só encaixa e redimensiona.
    s = saturate(entrada.SampleLevel(amostrador, uvt, 0).rgb);
  } else {
    // 1.0 = branco do SDR do monitor.
    float3 rel = max(entrada.SampleLevel(amostrador, uvt, 0).rgb * escala, 0);
    float Y = dot(rel, float3(0.2126, 0.7152, 0.0722));
    float Ye = Y * alvo;
    float pe = max(pico * alvo, joelho + 0.001);
    float p = (pe - joelho) / (1 - joelho);
    float x = max(Ye - joelho, 0) / (1 - joelho);
    // Reinhard estendido acima do joelho: contínuo e com a mesma inclinação
    // nele, e o pico do monitor cai em 1.0.
    float Yn = Ye <= joelho ? Ye : min(joelho + (1 - joelho) * (x * (1 + x / (p * p))) / (1 + x), 1);
    float3 c = Y > 1e-6 ? rel * (Yn / Y) : rel;
    // Cor saturada e clara: puxa para o branco em vez de cortar um canal, que
    // mudaria o matiz.
    c /= max(max(c.r, max(c.g, c.b)), 1);
    s = float3(srgb(c.r), srgb(c.g), srgb(c.b));
  }

  // O cursor (só no modo monitor) já é SDR: entra por cima, depois da
  // conversão.
  if (cursorVisivel != 0) {
    int2 ponto = int2(uvc * float2(conteudoW, conteudoH)) - int2(cursorX, cursorY);
    if (ponto.x >= 0 && ponto.y >= 0 && ponto.x < (int)cursorW && ponto.y < (int)cursorH) {
      float4 k = cursor.Load(int3(ponto, 0));
      s = lerp(s, k.rgb, k.a);
    }
  }
  saida[id.xy] = float4(s, 1);
}
)HLSL";

struct Parametros {
  float escala, pico, joelho, alvo;
  UINT conteudoW, conteudoH, texW, texH;
  UINT saidaW, saidaH, regX, regY;
  UINT regW, regH, cursorVisivel, direto;
  INT cursorX, cursorY;
  UINT cursorW, cursorH;
};

enum class Modo { Monitor, Janela };

struct Captura {
  Modo modo = Modo::Monitor;
  ComPtr<ID3D11Device> dispositivo;
  ComPtr<ID3D11DeviceContext> contexto;

  // Monitor.
  ComPtr<IDXGIOutput6> saidaMonitor;
  ComPtr<IDXGIOutputDuplication> duplicacao;
  ComPtr<ID3D11Texture2D> texturaCursor;
  ComPtr<ID3D11ShaderResourceView> srvCursor;
  UINT cursorCapacidade = 0;

  // Janela.
  wgc::GraphicsCaptureItem item{ nullptr };
  wgc::Direct3D11CaptureFramePool pool{ nullptr };
  wgc::GraphicsCaptureSession sessao{ nullptr };
  winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice dispositivoWinrt{ nullptr };
  winrt::event_token tokenFechou{};
  winrt::Windows::Graphics::SizeInt32 tamanhoDoPool{ 0, 0 };
  std::atomic<bool> janelaFechou{false};

  // Comum: o quadro capturado, a conversão e o anel de saída. O quadro é em
  // 16 bits (HDR) ou, na captura própria de janela em monitor comum, em 8.
  DXGI_FORMAT formato = DXGI_FORMAT_R16G16B16A16_FLOAT;
  wdx::DirectXPixelFormat formatoPool = wdx::DirectXPixelFormat::R16G16B16A16Float;
  ComPtr<ID3D11Texture2D> quadroHdr;
  ComPtr<ID3D11ShaderResourceView> srvQuadro;
  UINT texW = 0, texH = 0;
  ComPtr<ID3D11ComputeShader> shader;
  ComPtr<ID3D11SamplerState> amostrador;
  ComPtr<ID3D11Buffer> constantes;
  ComPtr<ID3D11Query> consulta;
  ComPtr<ID3D11Texture2D> anel[ANEL];
  ComPtr<ID3D11UnorderedAccessView> uav[ANEL];
  HANDLE alcas[ANEL] = {};
  std::atomic<bool> ocupada[ANEL];
  Parametros p = {};
  UINT saidaW = 0, saidaH = 0;
  int intervaloMs = 16;
  std::atomic<bool> rodando{false};
  std::thread linha;
  Napi::ThreadSafeFunction aviso;
  std::atomic<int> capturados{0}, entregues{0}, pulados{0}, recuperacoes{0};
};

Captura* atual = nullptr;
std::mutex trava;

double brancoSdr(const wchar_t* nomeGdi) {
  UINT32 nc = 0, nm = 0;
  if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &nc, &nm) != ERROR_SUCCESS) return 80;
  std::vector<DISPLAYCONFIG_PATH_INFO> caminhos(nc);
  std::vector<DISPLAYCONFIG_MODE_INFO> modos(nm);
  if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &nc, caminhos.data(), &nm, modos.data(), nullptr) != ERROR_SUCCESS) return 80;
  for (UINT32 i = 0; i < nc; i++) {
    DISPLAYCONFIG_SOURCE_DEVICE_NAME fonte = {};
    fonte.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    fonte.header.size = sizeof(fonte);
    fonte.header.adapterId = caminhos[i].sourceInfo.adapterId;
    fonte.header.id = caminhos[i].sourceInfo.id;
    if (DisplayConfigGetDeviceInfo(&fonte.header) != ERROR_SUCCESS) continue;
    if (wcscmp(fonte.viewGdiDeviceName, nomeGdi) != 0) continue;
    DISPLAYCONFIG_SDR_WHITE_LEVEL branco = {};
    branco.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL;
    branco.header.size = sizeof(branco);
    branco.header.adapterId = caminhos[i].targetInfo.adapterId;
    branco.header.id = caminhos[i].targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&branco.header) == ERROR_SUCCESS) return branco.SDRWhiteLevel / 1000.0 * 80.0;
  }
  return 80;
}

// Avisa o JS de um quadro pronto (k >= 0) ou do fim da captura (k < 0).
void avisar(Captura* c, int k, const std::string& motivo) {
  c->aviso.NonBlockingCall([k, motivo](Napi::Env env, Napi::Function fn) {
    if (k >= 0) fn.Call({ Napi::Number::New(env, k) });
    else fn.Call({ Napi::Number::New(env, k), Napi::String::New(env, motivo) });
  });
}

// O formato do cursor vem em três tipos; tudo vira RGBA com alfa.
void atualizarCursor(Captura* c, const DXGI_OUTDUPL_POINTER_SHAPE_INFO& forma, const std::vector<uint8_t>& dados) {
  UINT w = forma.Width;
  UINT h = forma.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME ? forma.Height / 2 : forma.Height;
  if (w == 0 || h == 0) return;
  std::vector<uint32_t> rgba(static_cast<size_t>(w) * h);

  for (UINT y = 0; y < h; y++) {
    for (UINT x = 0; x < w; x++) {
      uint32_t px = 0;
      if (forma.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME) {
        // Duas máscaras de 1 bit: AND em cima, XOR embaixo.
        uint8_t bit = 0x80 >> (x % 8);
        bool e = dados[y * forma.Pitch + x / 8] & bit;
        bool ou = dados[(y + h) * forma.Pitch + x / 8] & bit;
        if (!e) px = ou ? 0xFFFFFFFF : 0xFF000000;   // branco ou preto
        else if (ou) px = 0xFFFFFFFF;                 // inverter: branco aparece no jogo escuro
      } else {
        uint32_t bgra;
        std::memcpy(&bgra, &dados[y * forma.Pitch + x * 4], 4);
        uint8_t b = bgra & 0xFF, g = (bgra >> 8) & 0xFF, r = (bgra >> 16) & 0xFF, a = bgra >> 24;
        if (forma.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR) {
          // Alfa 0 = cor por cima; 0xFF = XOR com a tela, que com preto não muda nada.
          a = (a == 0 || (r | g | b)) ? 0xFF : 0;
        }
        px = (uint32_t(a) << 24) | (uint32_t(b) << 16) | (uint32_t(g) << 8) | r;
      }
      rgba[y * w + x] = px;
    }
  }

  UINT lado = (w > h ? w : h);
  if (!c->texturaCursor || lado > c->cursorCapacidade) {
    UINT capacidade = 32;
    while (capacidade < lado) capacidade *= 2;
    D3D11_TEXTURE2D_DESC td = {};
    td.Width = capacidade;
    td.Height = capacidade;
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    c->texturaCursor.Reset();
    c->srvCursor.Reset();
    if (FAILED(c->dispositivo->CreateTexture2D(&td, nullptr, &c->texturaCursor))) return;
    c->dispositivo->CreateShaderResourceView(c->texturaCursor.Get(), nullptr, &c->srvCursor);
    c->cursorCapacidade = capacidade;
  }
  D3D11_BOX caixa = { 0, 0, 0, w, h, 1 };
  c->contexto->UpdateSubresource(c->texturaCursor.Get(), 0, &caixa, rgba.data(), w * 4, 0);
  c->p.cursorW = w;
  c->p.cursorH = h;
}

// A textura em 16 bits onde cada quadro capturado é copiado. Na janela ela
// cresce quando a janela cresce (e não diminui: o shader lê só o pedaço com
// imagem).
bool garantirQuadroHdr(Captura* c, UINT w, UINT h) {
  if (c->quadroHdr && w <= c->texW && h <= c->texH) return true;
  UINT novoW = (std::max)(w, c->texW), novoH = (std::max)(h, c->texH);
  D3D11_TEXTURE2D_DESC td = {};
  td.Width = novoW;
  td.Height = novoH;
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.SampleDesc.Count = 1;
  td.Format = c->formato;
  td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  ComPtr<ID3D11Texture2D> nova;
  if (FAILED(c->dispositivo->CreateTexture2D(&td, nullptr, &nova))) return false;
  c->quadroHdr = nova;
  c->srvQuadro.Reset();
  c->dispositivo->CreateShaderResourceView(c->quadroHdr.Get(), nullptr, &c->srvQuadro);
  c->texW = novoW;
  c->texH = novoH;
  return true;
}

// Onde a imagem de (w, h) cabe na saída sem esticar: centralizada, com faixas
// pretas no que sobrar.
void encaixar(Captura* c, UINT w, UINT h) {
  double escala = (std::min)(double(c->saidaW) / w, double(c->saidaH) / h);
  UINT rw = (std::max)(1u, (std::min)(c->saidaW, UINT(w * escala + 0.5)));
  UINT rh = (std::max)(1u, (std::min)(c->saidaH, UINT(h * escala + 0.5)));
  c->p.conteudoW = w;
  c->p.conteudoH = h;
  c->p.regW = rw;
  c->p.regH = rh;
  c->p.regX = (c->saidaW - rw) / 2;
  c->p.regY = (c->saidaH - rh) / 2;
}

// Converte o quadro guardado numa textura livre do anel e avisa o JS. false
// se o anel está cheio (a página ainda não devolveu nenhuma).
bool entregar(Captura* c) {
  int k = -1;
  for (int i = 0; i < ANEL && k < 0; i++) {
    bool esperado = false;
    if (c->ocupada[i].compare_exchange_strong(esperado, true)) k = i;
  }
  if (k < 0) {
    c->pulados++;
    return false;
  }

  if (!c->srvCursor) c->p.cursorVisivel = 0;
  c->p.texW = c->texW;
  c->p.texH = c->texH;
  c->contexto->UpdateSubresource(c->constantes.Get(), 0, nullptr, &c->p, 0, 0);
  ID3D11ShaderResourceView* entradas[2] = { c->srvQuadro.Get(), c->srvCursor.Get() };
  c->contexto->CSSetShader(c->shader.Get(), nullptr, 0);
  c->contexto->CSSetShaderResources(0, 2, entradas);
  c->contexto->CSSetSamplers(0, 1, c->amostrador.GetAddressOf());
  c->contexto->CSSetConstantBuffers(0, 1, c->constantes.GetAddressOf());
  c->contexto->CSSetUnorderedAccessViews(0, 1, c->uav[k].GetAddressOf(), nullptr);
  c->contexto->Dispatch((c->saidaW + 15) / 16, (c->saidaH + 15) / 16, 1);
  ID3D11UnorderedAccessView* nenhuma = nullptr;
  c->contexto->CSSetUnorderedAccessViews(0, 1, &nenhuma, nullptr);
  // A textura compartilhada não tem trava: quem garante que a GPU terminou
  // antes de o Chromium ler é esta espera.
  c->contexto->End(c->consulta.Get());
  while (c->rodando && c->contexto->GetData(c->consulta.Get(), nullptr, 0, 0) == S_FALSE) {
    std::this_thread::yield();
  }
  c->entregues++;
  avisar(c, k, "");
  return true;
}

// Entrega quando há novidade e já passou o intervalo do fps, ou de tempos em
// tempos com a imagem parada.
struct Ritmo {
  Relogio::time_point ultima = Relogio::now() - std::chrono::seconds(10);
  bool pendente = false;
  bool vence(const Captura* c) const {
    auto passou = std::chrono::duration_cast<std::chrono::milliseconds>(Relogio::now() - ultima).count();
    return pendente ? passou >= c->intervaloMs : passou >= REPETIR_PARADO_MS;
  }
  void entregou() {
    ultima = Relogio::now();
    pendente = false;
  }
};

HRESULT duplicar(Captura* c) {
  c->duplicacao.Reset();
  DXGI_FORMAT formatos[] = { DXGI_FORMAT_R16G16B16A16_FLOAT };
  return c->saidaMonitor->DuplicateOutput1(c->dispositivo.Get(), 0, 1, formatos, &c->duplicacao);
}

void lacoMonitor(Captura* c) {
  bool temImagem = false;
  Ritmo ritmo;
  std::vector<uint8_t> forma;

  while (c->rodando) {
    ComPtr<IDXGIResource> recurso;
    DXGI_OUTDUPL_FRAME_INFO info = {};
    HRESULT hr = c->duplicacao->AcquireNextFrame(15, &info, &recurso);

    if (hr == DXGI_ERROR_ACCESS_LOST) {
      // Troca de modo de vídeo, aviso do administrador, jogo entrando em tela
      // cheia exclusiva. Tenta reabrir a duplicação por até 10 segundos.
      c->recuperacoes++;
      bool voltou = false;
      for (int t = 0; t < 100 && c->rodando && !voltou; t++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        voltou = SUCCEEDED(duplicar(c));
      }
      if (!voltou) { avisar(c, -1, "a captura HDR foi interrompida pelo Windows"); break; }
      DXGI_OUTDUPL_DESC dd;
      c->duplicacao->GetDesc(&dd);
      if (dd.ModeDesc.Width != c->p.conteudoW || dd.ModeDesc.Height != c->p.conteudoH) {
        avisar(c, -1, "a resolução do monitor mudou");
        break;
      }
      continue;
    }

    if (SUCCEEDED(hr)) {
      if (info.LastPresentTime.QuadPart != 0) {
        ComPtr<ID3D11Texture2D> textura;
        recurso.As(&textura);
        c->contexto->CopyResource(c->quadroHdr.Get(), textura.Get());
        temImagem = true;
        ritmo.pendente = true;
        c->capturados++;
      }
      if (info.LastMouseUpdateTime.QuadPart != 0) {
        c->p.cursorVisivel = info.PointerPosition.Visible ? 1 : 0;
        c->p.cursorX = info.PointerPosition.Position.x;
        c->p.cursorY = info.PointerPosition.Position.y;
        ritmo.pendente = true;
      }
      if (info.PointerShapeBufferSize > 0) {
        forma.resize(info.PointerShapeBufferSize);
        UINT usado = 0;
        DXGI_OUTDUPL_POINTER_SHAPE_INFO formaInfo = {};
        if (SUCCEEDED(c->duplicacao->GetFramePointerShape(info.PointerShapeBufferSize, forma.data(), &usado, &formaInfo))) {
          atualizarCursor(c, formaInfo, forma);
        }
      }
      c->duplicacao->ReleaseFrame();
    } else if (hr != DXGI_ERROR_WAIT_TIMEOUT) {
      avisar(c, -1, "a captura HDR falhou");
      break;
    }

    if (!temImagem || !ritmo.vence(c)) continue;
    if (entregar(c)) ritmo.entregou();
  }
  c->rodando = false;
}

void lacoJanela(Captura* c) {
  // O pool é "free threaded": os quadros podem ser lidos desta thread.
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  bool temImagem = false;
  Ritmo ritmo;

  while (c->rodando) {
    if (c->janelaFechou) {
      avisar(c, -1, "a janela foi fechada");
      break;
    }

    wgc::Direct3D11CaptureFrame quadro{ nullptr };
    try {
      quadro = c->pool.TryGetNextFrame();
    } catch (...) {
      avisar(c, -1, "a captura da janela falhou");
      break;
    }

    if (quadro) {
      auto tamanho = quadro.ContentSize();
      // Minimizada, a janela some (tamanho zero): mantém a última imagem.
      if (tamanho.Width >= 2 && tamanho.Height >= 2) {
        auto acesso = quadro.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        ComPtr<ID3D11Texture2D> textura;
        if (SUCCEEDED(acesso->GetInterface(IID_PPV_ARGS(&textura))) &&
            garantirQuadroHdr(c, tamanho.Width, tamanho.Height)) {
          D3D11_BOX caixa = { 0, 0, 0, UINT(tamanho.Width), UINT(tamanho.Height), 1 };
          c->contexto->CopySubresourceRegion(c->quadroHdr.Get(), 0, 0, 0, 0, textura.Get(), 0, &caixa);
          encaixar(c, tamanho.Width, tamanho.Height);
          temImagem = true;
          ritmo.pendente = true;
          c->capturados++;
        }
        // A janela mudou de tamanho: o pool precisa acompanhar, senão os
        // próximos quadros vêm cortados.
        if (tamanho.Width != c->tamanhoDoPool.Width || tamanho.Height != c->tamanhoDoPool.Height) {
          c->pool.Recreate(c->dispositivoWinrt, c->formatoPool, 2, tamanho);
          c->tamanhoDoPool = tamanho;
        }
      }
      quadro.Close();
    } else {
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }

    if (!temImagem || !ritmo.vence(c)) continue;
    if (entregar(c)) ritmo.entregou();
  }
  c->rodando = false;
  winrt::uninit_apartment();
}

void encerrar(Captura* c) {
  if (!c) return;
  c->rodando = false;
  if (c->linha.joinable()) c->linha.join();
  if (c->modo == Modo::Janela) {
    try {
      if (c->item) c->item.Closed(c->tokenFechou);
      if (c->sessao) c->sessao.Close();
      if (c->pool) c->pool.Close();
    } catch (...) { /* já fechada */ }
  }
  c->aviso.Release();
  for (int i = 0; i < ANEL; i++) {
    if (c->alcas[i]) CloseHandle(c->alcas[i]);
  }
  delete c;
}

// O monitor (e o adaptador dele) pelo retângulo em pixels físicos ou pelo
// HMONITOR. Devolve false se não achou.
bool acharMonitor(LONG x, LONG y, LONG largura, LONG altura, HMONITOR hmon,
                  ComPtr<IDXGIAdapter1>& adaptador, ComPtr<IDXGIOutput6>& monitor, DXGI_OUTPUT_DESC1& desc) {
  ComPtr<IDXGIFactory1> fabrica;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&fabrica)))) return false;
  ComPtr<IDXGIAdapter1> candidato;
  for (UINT a = 0; fabrica->EnumAdapters1(a, &candidato) != DXGI_ERROR_NOT_FOUND; a++) {
    ComPtr<IDXGIOutput> saida;
    for (UINT i = 0; candidato->EnumOutputs(i, &saida) != DXGI_ERROR_NOT_FOUND; i++) {
      ComPtr<IDXGIOutput6> s6;
      if (FAILED(saida.As(&s6))) continue;
      DXGI_OUTPUT_DESC1 d;
      s6->GetDesc1(&d);
      const RECT& r = d.DesktopCoordinates;
      bool bate = hmon ? d.Monitor == hmon
                       : (r.left == x && r.top == y && r.right - r.left == largura && r.bottom - r.top == altura);
      if (bate) {
        monitor = s6;
        adaptador = candidato;
        desc = d;
        return true;
      }
    }
  }
  return false;
}

// iniciar({ x, y, largura, altura } ou { hwnd }, mais saidaLargura,
// saidaAltura e fps; aviso)
//
// Monitor: x/y/largura/altura são o retângulo dele em pixels físicos, como o
// Windows o vê. Janela: hwnd é o número da janela (o do id "window:<hwnd>:..."
// do desktopCapturer). Devolve { hdr: false } se o monitor (o da janela, no
// caso dela) não está em HDR: aí não há o que converter e o app usa a captura
// de sempre.
Napi::Value Iniciar(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> guarda(trava);
  if (atual) { encerrar(atual); atual = nullptr; }

  auto falha = [&](const std::string& motivo) {
    Napi::Error::New(env, motivo).ThrowAsJavaScriptException();
    return env.Null();
  };
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) return falha("uso: iniciar(opcoes, aviso)");
  Napi::Object o = info[0].As<Napi::Object>();
  auto numero = [&](const char* nome, double padrao) {
    Napi::Value v = o.Get(nome);
    return v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : padrao;
  };
  double fps = numero("fps", 60);
  HWND hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(numero("hwnd", 0)));
  Modo modo = hwnd ? Modo::Janela : Modo::Monitor;
  // comum: a captura PRÓPRIA de janela (2.1.3), usada quando o Chromium não
  // consegue abrir a janela. Aí ela roda em qualquer monitor: com HDR,
  // converte como no Forçar SDR; sem, passa o quadro direto. direto força
  // o caminho sem conversão (é o que os testes usam num monitor em HDR).
  auto booleano = [&](const char* nome) {
    Napi::Value v = o.Get(nome);
    return v.IsBoolean() && v.As<Napi::Boolean>().Value();
  };
  const bool comum = booleano("comum") && modo == Modo::Janela;
  bool direto = booleano("direto") && modo == Modo::Janela;

  // A thread de captura usa coordenadas físicas do monitor.
  SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  if (modo == Modo::Janela && !IsWindow(hwnd)) return falha("essa janela não existe mais");
  HMONITOR hmon = modo == Modo::Janela ? MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) : nullptr;

  ComPtr<IDXGIAdapter1> adaptador;
  ComPtr<IDXGIOutput6> monitor;
  DXGI_OUTPUT_DESC1 desc = {};
  if (!acharMonitor(static_cast<LONG>(numero("x", 0)), static_cast<LONG>(numero("y", 0)),
                    static_cast<LONG>(numero("largura", 0)), static_cast<LONG>(numero("altura", 0)),
                    hmon, adaptador, monitor, desc)) {
    return falha("não achei esse monitor");
  }

  Napi::Object resposta = Napi::Object::New(env);
  const bool monitorHdr = desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
  if (!monitorHdr) {
    if (!comum) {
      resposta.Set("hdr", false);
      return resposta;
    }
    direto = true;
  }
  // Monitor girado chega deitado da duplicação, e não vale a pena girar aqui.
  if (modo == Modo::Monitor && desc.Rotation != DXGI_MODE_ROTATION_IDENTITY &&
      desc.Rotation != DXGI_MODE_ROTATION_UNSPECIFIED) {
    return falha("monitor girado não é suportado no Forçar SDR");
  }

  auto* c = new Captura();
  c->modo = modo;
  if (direto) {
    c->formato = DXGI_FORMAT_B8G8R8A8_UNORM;
    c->formatoPool = wdx::DirectXPixelFormat::B8G8R8A8UIntNormalized;
  }
  for (int i = 0; i < ANEL; i++) c->ocupada[i] = false;
  if (FAILED(D3D11CreateDevice(adaptador.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                               nullptr, 0, D3D11_SDK_VERSION, &c->dispositivo, nullptr, &c->contexto))) {
    delete c;
    return falha("não consegui abrir a placa de vídeo");
  }

  // O tamanho da imagem capturada, que decide o tamanho da saída.
  UINT origemW = 0, origemH = 0;
  if (modo == Modo::Monitor) {
    c->saidaMonitor = monitor;
    HRESULT hr = duplicar(c);
    if (FAILED(hr)) {
      delete c;
      return falha(hr == E_ACCESSDENIED ? "o Windows negou a captura agora (tela protegida)" : "o Windows recusou a captura HDR");
    }
    DXGI_OUTDUPL_DESC dd;
    c->duplicacao->GetDesc(&dd);
    origemW = dd.ModeDesc.Width;
    origemH = dd.ModeDesc.Height;
  } else {
    try {
      ComPtr<IDXGIDevice> dxgi;
      c->dispositivo.As(&dxgi);
      winrt::com_ptr<::IInspectable> inspecionavel;
      winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), inspecionavel.put()));
      c->dispositivoWinrt = inspecionavel.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();

      auto fabrica = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
      winrt::check_hresult(fabrica->CreateForWindow(hwnd, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(c->item)));
      c->tamanhoDoPool = c->item.Size();
      c->pool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
          c->dispositivoWinrt, c->formatoPool, 2, c->tamanhoDoPool);
      c->sessao = c->pool.CreateCaptureSession(c->item);
      c->sessao.IsCursorCaptureEnabled(true);
      // A borda amarela some no Windows 11; no 10 não tem como tirar.
      try { c->sessao.IsBorderRequired(false); } catch (...) {}
      c->tokenFechou = c->item.Closed([c](auto&&, auto&&) { c->janelaFechou = true; });
      c->sessao.StartCapture();
    } catch (const winrt::hresult_error& erro) {
      // O código vai junto: é ele que diz, no registro de quem teve o
      // problema, se foi o Windows sem suporte, acesso negado ou outra coisa.
      char codigo[16] = {};
      snprintf(codigo, sizeof(codigo), "0x%08X", static_cast<unsigned>(erro.code()));
      std::string motivo = "o Windows recusou a captura da janela (" + std::string(codigo) + ": " +
                           winrt::to_string(erro.message()) + ")";
      c->modo = Modo::Janela;
      encerrar(c);
      return falha(motivo);
    }
    origemW = static_cast<UINT>((std::max)(2, c->tamanhoDoPool.Width));
    origemH = static_cast<UINT>((std::max)(2, c->tamanhoDoPool.Height));
  }

  // A resolução pedida, sem aumentar e mantendo a proporção de quando
  // começou. Par, que é o que o codificador quer.
  double pedidaW = numero("saidaLargura", origemW), pedidaH = numero("saidaAltura", origemH);
  double escala = (std::min)({ pedidaW / origemW, pedidaH / origemH, 1.0 });
  c->saidaW = (std::max)(2u, (static_cast<UINT>(origemW * escala) / 2) * 2);
  c->saidaH = (std::max)(2u, (static_cast<UINT>(origemH * escala) / 2) * 2);
  c->intervaloMs = fps > 0 ? static_cast<int>(1000.0 / fps) - 1 : 16;
  c->p.saidaW = c->saidaW;
  c->p.saidaH = c->saidaH;

  if (!garantirQuadroHdr(c, origemW, origemH)) { encerrar(c); return falha("textura HDR"); }
  encaixar(c, origemW, origemH);

  D3D11_TEXTURE2D_DESC td = {};
  td.Width = c->saidaW;
  td.Height = c->saidaH;
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.SampleDesc.Count = 1;
  td.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  td.BindFlags = D3D11_BIND_UNORDERED_ACCESS | D3D11_BIND_SHADER_RESOURCE;
  td.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  Napi::Array alcas = Napi::Array::New(env, ANEL);
  for (int i = 0; i < ANEL; i++) {
    if (FAILED(c->dispositivo->CreateTexture2D(&td, nullptr, &c->anel[i]))) { encerrar(c); return falha("textura de saída"); }
    c->dispositivo->CreateUnorderedAccessView(c->anel[i].Get(), nullptr, &c->uav[i]);
    ComPtr<IDXGIResource1> recurso;
    c->anel[i].As(&recurso);
    if (FAILED(recurso->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &c->alcas[i]))) {
      encerrar(c);
      return falha("textura compartilhada");
    }
    alcas.Set(i, Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&c->alcas[i]), sizeof(HANDLE)));
  }

  ComPtr<ID3DBlob> binario, erros;
  if (FAILED(D3DCompile(SHADER, std::strlen(SHADER), nullptr, nullptr, nullptr, "main", "cs_5_0",
                        D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &binario, &erros))) {
    std::string motivo = erros ? static_cast<const char*>(erros->GetBufferPointer()) : "shader";
    encerrar(c);
    return falha(motivo);
  }
  c->dispositivo->CreateComputeShader(binario->GetBufferPointer(), binario->GetBufferSize(), nullptr, &c->shader);

  D3D11_SAMPLER_DESC sd = {};
  sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  sd.MaxLOD = D3D11_FLOAT32_MAX;
  c->dispositivo->CreateSamplerState(&sd, &c->amostrador);

  double branco = brancoSdr(desc.DeviceName);
  c->p.escala = static_cast<float>(80.0 / branco);
  c->p.pico = static_cast<float>((std::max)(desc.MaxLuminance, static_cast<float>(branco)) / branco);
  c->p.joelho = JOELHO;
  c->p.alvo = BRANCO_NA_SAIDA;
  c->p.direto = direto ? 1 : 0;
  D3D11_BUFFER_DESC bd = { sizeof(Parametros), D3D11_USAGE_DEFAULT, D3D11_BIND_CONSTANT_BUFFER, 0, 0, 0 };
  c->dispositivo->CreateBuffer(&bd, nullptr, &c->constantes);
  D3D11_QUERY_DESC qd = { D3D11_QUERY_EVENT, 0 };
  c->dispositivo->CreateQuery(&qd, &c->consulta);

  c->aviso = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "captura-hdr", 0, 1);
  c->rodando = true;
  c->linha = std::thread(modo == Modo::Monitor ? lacoMonitor : lacoJanela, c);
  atual = c;

  char nome[128] = {};
  WideCharToMultiByte(CP_UTF8, 0, desc.DeviceName, -1, nome, sizeof(nome), nullptr, nullptr);
  resposta.Set("hdr", true);
  resposta.Set("direto", direto);
  resposta.Set("monitorHdr", monitorHdr);
  resposta.Set("modo", modo == Modo::Monitor ? "monitor" : "janela");
  resposta.Set("monitor", nome);
  resposta.Set("largura", c->saidaW);
  resposta.Set("altura", c->saidaH);
  resposta.Set("entradaLargura", origemW);
  resposta.Set("entradaAltura", origemH);
  resposta.Set("branco", branco);
  resposta.Set("pico", desc.MaxLuminance);
  resposta.Set("alcas", alcas);
  return resposta;
}

Napi::Value Liberar(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> guarda(trava);
  if (atual && info.Length() > 0 && info[0].IsNumber()) {
    int k = info[0].As<Napi::Number>().Int32Value();
    if (k >= 0 && k < ANEL) atual->ocupada[k] = false;
  }
  return info.Env().Undefined();
}

Napi::Value Parar(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> guarda(trava);
  Napi::Object r = Napi::Object::New(env);
  if (!atual) return r;
  r.Set("capturados", atual->capturados.load());
  r.Set("entregues", atual->entregues.load());
  r.Set("pulados", atual->pulados.load());
  r.Set("recuperacoes", atual->recuperacoes.load());
  encerrar(atual);
  atual = nullptr;
  return r;
}

Napi::Object Inicializar(Napi::Env env, Napi::Object exports) {
  exports.Set("iniciar", Napi::Function::New(env, Iniciar));
  exports.Set("liberar", Napi::Function::New(env, Liberar));
  exports.Set("parar", Napi::Function::New(env, Parar));
  return exports;
}

}  // namespace

NODE_API_MODULE(captura_hdr, Inicializar)
