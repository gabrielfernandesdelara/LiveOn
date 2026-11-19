// Estado de HDR dos monitores, só leitura, para o registro.
//
// Com o HDR do Windows ligado, a captura de TELA pelo caminho antigo do
// Chromium (DXGI) chega estourada aos amigos: medido em 19/11/2026 no Odyssey
// do dono, um cinza de 17 chegava como 35 e tudo acima de ~60% virava branco.
// Pelo caminho novo (Windows Graphics Capture), que o Chromium usa no Windows
// 11 24H2 em diante, chega exato. O log diz se o HDR estava ligado e o Windows
// de cada um, e com isso dá para saber se foi esse o problema de um amigo.
//
// Lê pela API do Windows 11 24H2 em diante (GET_ADVANCED_COLOR_INFO_2), e
// pela antiga antes disso. A estrutura nova é declarada aqui, com nome
// próprio, para compilar mesmo com um SDK do Windows mais velho.

#include <napi.h>
#include <windows.h>

#include <string>
#include <vector>

namespace {

constexpr DISPLAYCONFIG_DEVICE_INFO_TYPE TIPO_COR_2 =
    static_cast<DISPLAYCONFIG_DEVICE_INFO_TYPE>(15);

struct InfoCor2 {
  DISPLAYCONFIG_DEVICE_INFO_HEADER header;
  union {
    struct {
      UINT32 advancedColorSupported : 1;
      UINT32 advancedColorActive : 1;
      UINT32 reserved1 : 1;
      UINT32 advancedColorLimitedByPolicy : 1;
      UINT32 highDynamicRangeSupported : 1;
      UINT32 highDynamicRangeUserEnabled : 1;
      UINT32 wideColorSupported : 1;
      UINT32 wideColorUserEnabled : 1;
      UINT32 reserved : 24;
    };
    UINT32 value;
  };
  UINT32 colorEncoding;
  UINT32 bitsPerColorChannel;
  // 0 = SDR, 1 = cor ampla (WCG), 2 = HDR.
  UINT32 activeColorMode;
};

struct Monitor {
  LUID adaptador;
  UINT32 alvo;
  std::wstring caminho;
  std::wstring nome;
  bool suportado = false;
  bool ligado = false;
};

std::string utf8(const std::wstring& texto) {
  if (texto.empty()) return {};
  int tamanho = WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), static_cast<int>(texto.size()),
                                    nullptr, 0, nullptr, nullptr);
  std::string saida(tamanho, '\0');
  WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), static_cast<int>(texto.size()),
                      saida.data(), tamanho, nullptr, nullptr);
  return saida;
}

// Lê o estado de cor de um monitor, pela API nova quando o Windows tem.
void lerCor(Monitor& m) {
  InfoCor2 nova = {};
  nova.header.type = TIPO_COR_2;
  nova.header.size = sizeof(nova);
  nova.header.adapterId = m.adaptador;
  nova.header.id = m.alvo;
  if (DisplayConfigGetDeviceInfo(&nova.header) == ERROR_SUCCESS) {
    m.suportado = nova.highDynamicRangeSupported != 0;
    m.ligado = nova.activeColorMode == 2;
    return;
  }

  DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO antiga = {};
  antiga.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
  antiga.header.size = sizeof(antiga);
  antiga.header.adapterId = m.adaptador;
  antiga.header.id = m.alvo;
  if (DisplayConfigGetDeviceInfo(&antiga.header) == ERROR_SUCCESS) {
    m.suportado = antiga.advancedColorSupported != 0;
    m.ligado = antiga.advancedColorEnabled != 0 && antiga.wideColorEnforced == 0;
  }
}

std::vector<Monitor> monitores() {
  std::vector<Monitor> lista;

  UINT32 quantosCaminhos = 0;
  UINT32 quantosModos = 0;
  std::vector<DISPLAYCONFIG_PATH_INFO> caminhos;
  std::vector<DISPLAYCONFIG_MODE_INFO> modos;

  // A configuração pode mudar entre perguntar o tamanho e ler: tenta de novo.
  LONG resultado = ERROR_INSUFFICIENT_BUFFER;
  for (int tentativa = 0; tentativa < 3 && resultado == ERROR_INSUFFICIENT_BUFFER; tentativa++) {
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &quantosCaminhos, &quantosModos) != ERROR_SUCCESS) {
      return lista;
    }
    caminhos.resize(quantosCaminhos);
    modos.resize(quantosModos);
    resultado = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &quantosCaminhos, caminhos.data(),
                                   &quantosModos, modos.data(), nullptr);
  }
  if (resultado != ERROR_SUCCESS) return lista;
  caminhos.resize(quantosCaminhos);

  for (const auto& caminho : caminhos) {
    Monitor m;
    m.adaptador = caminho.targetInfo.adapterId;
    m.alvo = caminho.targetInfo.id;

    DISPLAYCONFIG_TARGET_DEVICE_NAME nome = {};
    nome.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
    nome.header.size = sizeof(nome);
    nome.header.adapterId = m.adaptador;
    nome.header.id = m.alvo;
    if (DisplayConfigGetDeviceInfo(&nome.header) == ERROR_SUCCESS) {
      m.caminho = nome.monitorDevicePath;
      m.nome = nome.monitorFriendlyDeviceName;
    }
    if (m.caminho.empty()) continue;
    if (m.nome.empty()) m.nome = L"Monitor";

    // Monitor espelhado aparece duas vezes, com o mesmo caminho.
    bool repetido = false;
    for (const auto& outro : lista) repetido = repetido || outro.caminho == m.caminho;
    if (repetido) continue;

    lerCor(m);
    lista.push_back(m);
  }
  return lista;
}

// [{ caminho, nome, suportado, ligado }]
Napi::Value Listar(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto lista = monitores();
  Napi::Array saida = Napi::Array::New(env, lista.size());
  for (size_t i = 0; i < lista.size(); i++) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("caminho", utf8(lista[i].caminho));
    item.Set("nome", utf8(lista[i].nome));
    item.Set("suportado", lista[i].suportado);
    item.Set("ligado", lista[i].ligado);
    saida.Set(static_cast<uint32_t>(i), item);
  }
  return saida;
}

Napi::Object Inicializar(Napi::Env env, Napi::Object exports) {
  exports.Set("listar", Napi::Function::New(env, Listar));
  return exports;
}

}  // namespace

NODE_API_MODULE(cor_tela, Inicializar)
