{
  "targets": [
    {
      "target_name": "captura_audio",
      "sources": [
        "src/captura_audio.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "ole32.lib",
              "mmdevapi.lib",
              "avrt.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ]
      ]
    },
    {
      "target_name": "cor_tela",
      "sources": [
        "src/cor_tela.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "user32.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ]
      ]
    },
    {
      "target_name": "captura_hdr",
      "sources": [
        "src/captura_hdr.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "d3d11.lib",
              "dxgi.lib",
              "d3dcompiler.lib",
              "user32.lib",
              "windowsapp.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "/std:c++17",
                  "/permissive-",
                  "/bigobj"
                ]
              }
            }
          }
        ]
      ]
    }
  ]
}
