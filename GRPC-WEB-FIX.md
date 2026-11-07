# gRPC-Web decoder fix

The shared Sparx requesticator now parses every gRPC-Web frame using the 5-byte frame header and ignores trailer frames before protobuf decoding. This prevents response frame headers/trailers from being passed into the protobuf decoder, which caused errors such as `illegal tag: field no 13 wire type 7`.

The fix is in `autocompleters/sparx/requesticator.js`, which is shared by the Maths, Reader and Science Sparx requesticators. It therefore applies to all three Sparx autocompleters rather than only Reader.

The Lifetime and Free Trial role IDs remain configured in `config.json`.
