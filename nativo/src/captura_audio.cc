// Captura de audio por processo no Windows (WASAPI process loopback).
//
// E isto que o loopback comum nao faz: aqui da para pegar "tudo que sai do
// sistema MENOS o Discord", que e o que impede a voz dos amigos de voltar
// para eles em eco.
//
// Exige Windows 10 versao 2004 (build 19041) ou maior.
//
// A ativacao e a captura acontecem numa thread propria em modo MTA. Isso e
// deliberado: ActivateAudioInterfaceAsync espera um evento, e esperar evento
// numa thread STA (que e o que o processo principal do Electron costuma ser)
// trava sem bombear mensagens.

#include <napi.h>

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <avrt.h>
#include <tlhelp32.h>
#include <wrl/implements.h>

#include <atomic>
#include <map>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

namespace {

// Separador de caminho do Windows, por codigo. Escrito assim de proposito:
// a barra invertida literal vira uma briga de escapes em qualquer ferramenta
// que gere ou edite este arquivo.
constexpr wchar_t kBarraInvertida = static_cast<wchar_t>(92);

std::string ParaUtf8(const wchar_t* texto) {
  if (!texto) return {};
  int tamanho = WideCharToMultiByte(CP_UTF8, 0, texto, -1, nullptr, 0, nullptr, nullptr);
  if (tamanho <= 1) return {};
  std::string saida(static_cast<size_t>(tamanho - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, texto, -1, saida.data(), tamanho, nullptr, nullptr);
  return saida;
}

std::string CodigoHr(HRESULT hr) {
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "0x%08lX", static_cast<unsigned long>(hr));
  return buffer;
}

// Traduz os erros que realmente aparecem nesse caminho. O resto vai em hex.
std::string ExplicarHr(HRESULT hr) {
  switch (hr) {
    case AUDCLNT_E_DEVICE_INVALIDATED:
      return "dispositivo de audio invalidado (mudou a saida padrao?)";
    case AUDCLNT_E_UNSUPPORTED_FORMAT:
      return "formato de audio nao suportado";
    case AUDCLNT_E_DEVICE_IN_USE:
      return "dispositivo em uso exclusivo por outro programa";
    case E_ACCESSDENIED:
      return "acesso negado ao processo alvo";
    case E_INVALIDARG:
      return "argumento invalido (pid inexistente?)";
    default:
      return "HRESULT " + CodigoHr(hr);
  }
}

// Sobe a cadeia de processos enquanto o executavel for o MESMO, e devolve o
// processo mais alto do aplicativo.
//
// Existe por causa do Discord: como todo app Chromium, ele roda em varios
// processos, e a sessao de audio pertence a um filho. Excluir esse filho deixa
// os irmaos tocando. Excluindo a raiz, o modo EXCLUDE_TARGET_PROCESS_TREE pega
// o aplicativo inteiro.
DWORD RaizDoAplicativo(DWORD pid) {
  if (pid == 0) return 0;

  HANDLE retrato = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (retrato == INVALID_HANDLE_VALUE) return pid;

  struct Entrada {
    DWORD pai;
    std::wstring executavel;
  };
  std::map<DWORD, Entrada> processos;

  PROCESSENTRY32W entrada = {};
  entrada.dwSize = sizeof(entrada);

  if (Process32FirstW(retrato, &entrada)) {
    do {
      processos[entrada.th32ProcessID] = {entrada.th32ParentProcessID, entrada.szExeFile};
    } while (Process32NextW(retrato, &entrada));
  }
  CloseHandle(retrato);

  auto atual = processos.find(pid);
  if (atual == processos.end()) return pid;

  DWORD raiz = pid;
  const std::wstring& executavel = atual->second.executavel;

  // O limite evita laco infinito se a arvore vier corrompida ou com pid reciclado.
  for (int passo = 0; passo < 16; passo++) {
    auto atualNo = processos.find(raiz);
    if (atualNo == processos.end()) break;

    const DWORD pai = atualNo->second.pai;
    if (pai == 0 || pai == raiz) break;

    auto paiNo = processos.find(pai);
    if (paiNo == processos.end()) break;
    if (_wcsicmp(paiNo->second.executavel.c_str(), executavel.c_str()) != 0) break;

    raiz = pai;
  }

  return raiz;
}

// Recebe o IAudioClient quando a ativacao assincrona termina.
class ManipuladorAtivacao
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE concluido = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT resultado = E_FAIL;
  ComPtr<IAudioClient> cliente;

  ~ManipuladorAtivacao() {
    if (concluido) CloseHandle(concluido);
  }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operacao) override {
    HRESULT hrAtivacao = E_FAIL;
    ComPtr<IUnknown> obtido;

    HRESULT hr = operacao->GetActivateResult(&hrAtivacao, &obtido);
    if (SUCCEEDED(hr) && SUCCEEDED(hrAtivacao) && obtido) {
      resultado = obtido.As(&cliente);
    } else {
      resultado = FAILED(hr) ? hr : hrAtivacao;
    }

    SetEvent(concluido);
    return S_OK;
  }
};

// Formatos tentados em ordem. O caminho de process loopback NAO aceita
// GetMixFormat, entao o formato tem que ser declarado na mao, e se errar,
// vem silencio sem erro nenhum. Por isso a lista de tentativas.
struct FormatoCandidato {
  WORD tag;
  WORD bits;
  DWORD taxa;
};

const FormatoCandidato kCandidatos[] = {
    {WAVE_FORMAT_IEEE_FLOAT, 32, 48000},
    {WAVE_FORMAT_PCM, 16, 48000},
    {WAVE_FORMAT_IEEE_FLOAT, 32, 44100},
    {WAVE_FORMAT_PCM, 16, 44100},
};

WAVEFORMATEX MontarFormato(const FormatoCandidato& c) {
  WAVEFORMATEX f = {};
  f.wFormatTag = c.tag;
  f.nChannels = 2;
  f.nSamplesPerSec = c.taxa;
  f.wBitsPerSample = c.bits;
  f.nBlockAlign = static_cast<WORD>(f.nChannels * f.wBitsPerSample / 8);
  f.nAvgBytesPerSec = f.nSamplesPerSec * f.nBlockAlign;
  f.cbSize = 0;
  return f;
}

}  // namespace

// ===========================================================================
// Captura
// ===========================================================================

class Captura : public Napi::ObjectWrap<Captura> {
 public:
  static Napi::Object Iniciar(Napi::Env env, Napi::Object exports);
  explicit Captura(const Napi::CallbackInfo& info);
  ~Captura();

 private:
  Napi::Value Parar(const Napi::CallbackInfo& info);
  Napi::Value Formato(const Napi::CallbackInfo& info);
  Napi::Value Descartados(const Napi::CallbackInfo& info);

  void Laco();
  HRESULT Preparar();
  void Encerrar();

  DWORD pid_ = 0;
  PROCESS_LOOPBACK_MODE modo_ = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  ComPtr<IAudioClient> cliente_;
  ComPtr<IAudioCaptureClient> capturador_;
  WAVEFORMATEX formato_ = {};

  HANDLE eventoAudio_ = nullptr;
  HANDLE eventoParar_ = nullptr;
  HANDLE eventoPronto_ = nullptr;

  std::thread linha_;
  std::atomic<bool> rodando_{false};
  std::atomic<uint64_t> descartados_{0};
  HRESULT resultadoInicio_ = E_FAIL;

  Napi::ThreadSafeFunction tsfn_;
};

Napi::Object Captura::Iniciar(Napi::Env env, Napi::Object exports) {
  Napi::Function classe = DefineClass(
      env, "Captura",
      {
          InstanceMethod("parar", &Captura::Parar),
          InstanceMethod("formato", &Captura::Formato),
          InstanceMethod("descartados", &Captura::Descartados),
      });

  exports.Set("Captura", classe);
  return exports;
}

Captura::Captura(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Captura>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "esperava um objeto de opcoes").ThrowAsJavaScriptException();
    return;
  }

  Napi::Object opcoes = info[0].As<Napi::Object>();

  if (!opcoes.Has("pid") || !opcoes.Get("pid").IsNumber()) {
    Napi::TypeError::New(env, "opcoes.pid e obrigatorio").ThrowAsJavaScriptException();
    return;
  }
  pid_ = static_cast<DWORD>(opcoes.Get("pid").As<Napi::Number>().Uint32Value());

  std::string modo = opcoes.Has("modo")
                         ? opcoes.Get("modo").As<Napi::String>().Utf8Value()
                         : "excluir";
  modo_ = (modo == "incluir") ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                              : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  if (!opcoes.Has("aoReceber") || !opcoes.Get("aoReceber").IsFunction()) {
    Napi::TypeError::New(env, "opcoes.aoReceber precisa ser uma funcao")
        .ThrowAsJavaScriptException();
    return;
  }

  tsfn_ = Napi::ThreadSafeFunction::New(
      env, opcoes.Get("aoReceber").As<Napi::Function>(), "captura-audio", 0, 1);

  eventoAudio_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  eventoParar_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  eventoPronto_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);

  rodando_ = true;
  linha_ = std::thread(&Captura::Laco, this);

  // Espera a thread reportar se conseguiu abrir a captura, para o erro chegar
  // ao JavaScript de forma sincrona em vez de sumir.
  WaitForSingleObject(eventoPronto_, 5000);

  if (FAILED(resultadoInicio_)) {
    rodando_ = false;
    SetEvent(eventoParar_);
    if (linha_.joinable()) linha_.join();
    tsfn_.Release();
    Napi::Error::New(env, "nao consegui iniciar a captura: " + ExplicarHr(resultadoInicio_))
        .ThrowAsJavaScriptException();
  }
}

Captura::~Captura() {
  Encerrar();
  if (eventoAudio_) CloseHandle(eventoAudio_);
  if (eventoParar_) CloseHandle(eventoParar_);
  if (eventoPronto_) CloseHandle(eventoPronto_);
}

void Captura::Encerrar() {
  if (!rodando_.exchange(false)) return;
  if (eventoParar_) SetEvent(eventoParar_);
  if (linha_.joinable()) linha_.join();
  tsfn_.Release();
}

Napi::Value Captura::Parar(const Napi::CallbackInfo& info) {
  Encerrar();
  return info.Env().Undefined();
}

Napi::Value Captura::Formato(const Napi::CallbackInfo& info) {
  Napi::Object saida = Napi::Object::New(info.Env());
  saida.Set("taxa", Napi::Number::New(info.Env(), formato_.nSamplesPerSec));
  saida.Set("canais", Napi::Number::New(info.Env(), formato_.nChannels));
  saida.Set("bits", Napi::Number::New(info.Env(), formato_.wBitsPerSample));
  return saida;
}

Napi::Value Captura::Descartados(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), static_cast<double>(descartados_.load()));
}

HRESULT Captura::Preparar() {
  AUDIOCLIENT_ACTIVATION_PARAMS parametros = {};
  parametros.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parametros.ProcessLoopbackParams.TargetProcessId = pid_;
  parametros.ProcessLoopbackParams.ProcessLoopbackMode = modo_;

  PROPVARIANT propriedade = {};
  propriedade.vt = VT_BLOB;
  propriedade.blob.cbSize = sizeof(parametros);
  propriedade.blob.pBlobData = reinterpret_cast<BYTE*>(&parametros);

  auto manipulador = Microsoft::WRL::Make<ManipuladorAtivacao>();
  if (!manipulador) return E_OUTOFMEMORY;

  ComPtr<IActivateAudioInterfaceAsyncOperation> operacao;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
      &propriedade, manipulador.Get(), &operacao);
  if (FAILED(hr)) return hr;

  if (WaitForSingleObject(manipulador->concluido, 5000) != WAIT_OBJECT_0) {
    return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  }
  if (FAILED(manipulador->resultado)) return manipulador->resultado;

  cliente_ = manipulador->cliente;

  // 20ms de buffer, com aviso por evento. Periodicidade 0 = deixa o Windows
  // escolher, que e o que a documentacao pede nesse modo.
  const REFERENCE_TIME duracao = 200000;

  hr = AUDCLNT_E_UNSUPPORTED_FORMAT;
  for (const auto& candidato : kCandidatos) {
    formato_ = MontarFormato(candidato);
    hr = cliente_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        duracao, 0, &formato_, nullptr);
    if (SUCCEEDED(hr)) break;
  }
  if (FAILED(hr)) return hr;

  hr = cliente_->SetEventHandle(eventoAudio_);
  if (FAILED(hr)) return hr;

  hr = cliente_->GetService(__uuidof(IAudioCaptureClient), &capturador_);
  if (FAILED(hr)) return hr;

  return cliente_->Start();
}

void Captura::Laco() {
  // MTA de proposito: ver o comentario do topo do arquivo.
  HRESULT hrCom = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool desfazerCom = SUCCEEDED(hrCom);

  resultadoInicio_ = Preparar();
  SetEvent(eventoPronto_);

  if (FAILED(resultadoInicio_)) {
    capturador_.Reset();
    cliente_.Reset();
    if (desfazerCom) CoUninitialize();
    return;
  }

  // Prioridade de audio, para o buffer nao estourar quando o jogo pesa a CPU.
  DWORD tarefa = 0;
  HANDLE identificador = AvSetMmThreadCharacteristicsW(L"Audio", &tarefa);

  HANDLE esperar[2] = {eventoParar_, eventoAudio_};
  const bool ehFloat = formato_.wFormatTag == WAVE_FORMAT_IEEE_FLOAT;

  while (rodando_) {
    DWORD qual = WaitForMultipleObjects(2, esperar, FALSE, 2000);
    if (qual == WAIT_OBJECT_0) break;       // pediram para parar
    if (qual == WAIT_TIMEOUT) continue;     // silencio total, sem pacote
    if (qual != WAIT_OBJECT_0 + 1) break;   // erro na espera

    UINT32 disponivel = 0;
    while (SUCCEEDED(capturador_->GetNextPacketSize(&disponivel)) && disponivel > 0) {
      BYTE* dados = nullptr;
      UINT32 quadros = 0;
      DWORD sinalizadores = 0;

      HRESULT hr = capturador_->GetBuffer(&dados, &quadros, &sinalizadores, nullptr, nullptr);
      if (FAILED(hr)) break;

      const size_t amostras = static_cast<size_t>(quadros) * formato_.nChannels;
      auto* bloco = new std::vector<float>(amostras);

      if (sinalizadores & AUDCLNT_BUFFERFLAGS_SILENT) {
        // Silencio digital: o Windows nao preenche o buffer, so avisa.
        std::fill(bloco->begin(), bloco->end(), 0.0f);
      } else if (ehFloat) {
        memcpy(bloco->data(), dados, amostras * sizeof(float));
      } else {
        const auto* inteiros = reinterpret_cast<const int16_t*>(dados);
        for (size_t i = 0; i < amostras; i++) {
          (*bloco)[i] = inteiros[i] / 32768.0f;
        }
      }

      capturador_->ReleaseBuffer(quadros);

      // NonBlockingCall de proposito: se o JavaScript engasgar, e melhor
      // descartar audio do que travar a thread de captura e furar o buffer.
      napi_status estado = tsfn_.NonBlockingCall(
          bloco, [](Napi::Env env, Napi::Function js, std::vector<float>* pedaco) {
            Napi::Float32Array buffer = Napi::Float32Array::New(env, pedaco->size());
            memcpy(buffer.Data(), pedaco->data(), pedaco->size() * sizeof(float));
            js.Call({buffer});
            delete pedaco;
          });

      if (estado != napi_ok) {
        delete bloco;
        descartados_++;
      }
    }
  }

  if (cliente_) cliente_->Stop();
  if (identificador) AvRevertMmThreadCharacteristics(identificador);

  capturador_.Reset();
  cliente_.Reset();
  if (desfazerCom) CoUninitialize();
}

// ===========================================================================
// Listagem dos aplicativos que estao tocando som
// ===========================================================================

// Nome amigavel do dispositivo, para a UI e para o diagnostico.
std::string NomeDoDispositivo(IMMDevice* dispositivo) {
  ComPtr<IPropertyStore> propriedades;
  if (FAILED(dispositivo->OpenPropertyStore(STGM_READ, &propriedades))) return "?";

  PROPVARIANT valor;
  PropVariantInit(&valor);
  std::string nome = "?";
  if (SUCCEEDED(propriedades->GetValue(PKEY_Device_FriendlyName, &valor)) &&
      valor.vt == VT_LPWSTR) {
    nome = ParaUtf8(valor.pwszVal);
  }
  PropVariantClear(&valor);
  return nome;
}

std::wstring IdDoDispositivo(IMMDevice* dispositivo) {
  LPWSTR id = nullptr;
  if (FAILED(dispositivo->GetId(&id)) || !id) return L"";
  std::wstring copia(id);
  CoTaskMemFree(id);
  return copia;
}

// Sessoes de um dispositivo. Escreve direto no array de saida.
void ColherSessoes(Napi::Env env, Napi::Array& saida, uint32_t& indice,
                   IMMDevice* dispositivo, const std::string& nomeDoDispositivo,
                   const std::string& papeis) {
  ComPtr<IAudioSessionManager2> gerente;
  if (FAILED(dispositivo->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL,
                                   nullptr, &gerente))) {
    return;
  }

  ComPtr<IAudioSessionEnumerator> sessoes;
  if (FAILED(gerente->GetSessionEnumerator(&sessoes))) return;

  int total = 0;
  sessoes->GetCount(&total);

  for (int i = 0; i < total; i++) {
    ComPtr<IAudioSessionControl> controle;
    if (FAILED(sessoes->GetSession(i, &controle))) continue;

    ComPtr<IAudioSessionControl2> controle2;
    if (FAILED(controle.As(&controle2))) continue;

    // Ignora a sessao do proprio sistema (bipes, notificacoes do shell).
    if (controle2->IsSystemSoundsSession() == S_OK) continue;

    DWORD pid = 0;
    if (FAILED(controle2->GetProcessId(&pid)) || pid == 0) continue;

    std::string nome;
    HANDLE processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (processo) {
      wchar_t caminho[MAX_PATH] = {};
      DWORD tamanho = MAX_PATH;
      if (QueryFullProcessImageNameW(processo, 0, caminho, &tamanho)) {
        const wchar_t* barra = wcsrchr(caminho, kBarraInvertida);
        nome = ParaUtf8(barra ? barra + 1 : caminho);
      }
      CloseHandle(processo);
    }
    if (nome.empty()) continue;

    AudioSessionState estado = AudioSessionStateInactive;
    controle2->GetState(&estado);

    Napi::Object item = Napi::Object::New(env);
    item.Set("pid", Napi::Number::New(env, pid));
    item.Set("raiz", Napi::Number::New(env, RaizDoAplicativo(pid)));
    item.Set("nome", Napi::String::New(env, nome));
    item.Set("tocando", Napi::Boolean::New(env, estado == AudioSessionStateActive));
    item.Set("dispositivo", Napi::String::New(env, nomeDoDispositivo));
    item.Set("papeis", Napi::String::New(env, papeis));
    saida.Set(indice++, item);
  }
}

// Percorre TODOS os dispositivos de saida ativos, nao so o padrao.
//
// Motivo: o Windows tem padroes separados para multimidia e para comunicacao,
// e o Discord usa o de comunicacao. Olhando so o padrao de multimidia, a sessao
// dele aparecia como parada, ou nem aparecia.
Napi::Value ListarSessoes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array saida = Napi::Array::New(env);
  uint32_t indice = 0;

  HRESULT hrCom = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const bool desfazerCom = SUCCEEDED(hrCom);

  ComPtr<IMMDeviceEnumerator> enumerador;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(&enumerador));
  if (FAILED(hr)) {
    if (desfazerCom) CoUninitialize();
    Napi::Error::New(env, "nao consegui abrir o enumerador de audio: " + ExplicarHr(hr))
        .ThrowAsJavaScriptException();
    return saida;
  }

  // Descobre quais dispositivos sao padrao em cada papel, para rotular.
  const ERole papeisConsultados[] = {eConsole, eMultimedia, eCommunications};
  const char* nomesDosPapeis[] = {"console", "multimidia", "comunicacao"};
  std::wstring idsPadrao[3];

  for (int i = 0; i < 3; i++) {
    ComPtr<IMMDevice> padrao;
    if (SUCCEEDED(enumerador->GetDefaultAudioEndpoint(eRender, papeisConsultados[i], &padrao))) {
      idsPadrao[i] = IdDoDispositivo(padrao.Get());
    }
  }

  ComPtr<IMMDeviceCollection> colecao;
  hr = enumerador->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &colecao);
  if (FAILED(hr)) {
    if (desfazerCom) CoUninitialize();
    return saida;
  }

  UINT quantos = 0;
  colecao->GetCount(&quantos);

  for (UINT i = 0; i < quantos; i++) {
    ComPtr<IMMDevice> dispositivo;
    if (FAILED(colecao->Item(i, &dispositivo))) continue;

    const std::wstring id = IdDoDispositivo(dispositivo.Get());
    std::string papeis;
    for (int p = 0; p < 3; p++) {
      if (!idsPadrao[p].empty() && idsPadrao[p] == id) {
        if (!papeis.empty()) papeis += "+";
        papeis += nomesDosPapeis[p];
      }
    }

    ColherSessoes(env, saida, indice, dispositivo.Get(),
                  NomeDoDispositivo(dispositivo.Get()), papeis);
  }

  if (desfazerCom) CoUninitialize();
  return saida;
}

Napi::Value PidDaJanela(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "esperava o HWND como numero").ThrowAsJavaScriptException();
    return Napi::Number::New(env, 0);
  }

  const int64_t valor = info[0].As<Napi::Number>().Int64Value();
  HWND janela = reinterpret_cast<HWND>(static_cast<intptr_t>(valor));

  if (!IsWindow(janela)) return Napi::Number::New(env, 0);

  DWORD pid = 0;
  GetWindowThreadProcessId(janela, &pid);
  return Napi::Number::New(env, pid);
}

Napi::Value RaizDoAplicativoJs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "esperava um pid").ThrowAsJavaScriptException();
    return Napi::Number::New(env, 0);
  }
  const DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  return Napi::Number::New(env, RaizDoAplicativo(pid));
}

Napi::Value Suportado(const Napi::CallbackInfo& info) {
  // Process loopback existe a partir do Windows 10 build 19041.
  HMODULE mmdev = GetModuleHandleW(L"Mmdevapi.dll");
  bool temApi = mmdev && GetProcAddress(mmdev, "ActivateAudioInterfaceAsync");
  if (!temApi) {
    HMODULE carregado = LoadLibraryW(L"Mmdevapi.dll");
    temApi = carregado && GetProcAddress(carregado, "ActivateAudioInterfaceAsync");
  }
  return Napi::Boolean::New(info.Env(), temApi);
}

Napi::Object Inicializar(Napi::Env env, Napi::Object exports) {
  Captura::Iniciar(env, exports);
  exports.Set("listarSessoes", Napi::Function::New(env, ListarSessoes));
  exports.Set("pidDaJanela", Napi::Function::New(env, PidDaJanela));
  exports.Set("raizDoAplicativo", Napi::Function::New(env, RaizDoAplicativoJs));
  exports.Set("suportado", Napi::Function::New(env, Suportado));
  return exports;
}

NODE_API_MODULE(captura_audio, Inicializar)
