# Dibuja el icono de Rubenchuelo (el mismo que app/publico/icono.svg) en varios
# tamaños y lo guarda como herramientas\exe\icono.ico y app\publico\icono.png.
# Solo hace falta volver a ejecutarlo si cambia el dibujo.

Add-Type -AssemblyName System.Drawing
$raiz = Split-Path -Parent $PSScriptRoot

function Color($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function Dibujar([int]$n) {
  $bmp = New-Object System.Drawing.Bitmap $n, $n, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform($n / 32.0, $n / 32.0)
  # Portaobjetos redondeado.
  $d = 16
  $marco = New-Object System.Drawing.Drawing2D.GraphicsPath
  $marco.AddArc(0, 0, $d, $d, 180, 90)
  $marco.AddArc(32 - $d, 0, $d, $d, 270, 90)
  $marco.AddArc(32 - $d, 32 - $d, $d, $d, 0, 90)
  $marco.AddArc(0, 32 - $d, $d, $d, 90, 90)
  $marco.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush (Color '#0d1322')), $marco)
  # Dendritas: más gruesas en los tamaños pequeños para que se vean.
  $grosor = if ($n -le 24) { 3.2 } elseif ($n -le 48) { 2.7 } else { 2.4 }
  foreach ($l in @(
      @('#4fd1c5', 16, 16, 6, 8), @('#4fd1c5', 16, 16, 5, 20), @('#c792ff', 16, 16, 14, 4),
      @('#ffc24b', 16, 16, 27, 27), @('#ffc24b', 23, 23, 29, 19))) {
    $p = New-Object System.Drawing.Pen (Color $l[0]), $grosor
    $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($p, [single]$l[1], [single]$l[2], [single]$l[3], [single]$l[4])
  }
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (Color '#4fd1c5')), 10.6, 10.6, 10.8, 10.8)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (Color '#e8fbff')), 13.7, 13.7, 4.6, 4.6)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}

$tamanos = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$imagenes = @()
foreach ($n in $tamanos) { $imagenes += ,(Dibujar $n) }

# Un .ico es una cabecera, una entrada por tamaño y las imágenes (en PNG).
$salida = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $salida
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$tamanos.Count)
$desplazamiento = 6 + 16 * $tamanos.Count
for ($i = 0; $i -lt $tamanos.Count; $i++) {
  $n = $tamanos[$i]
  $lado = if ($n -ge 256) { 0 } else { $n }
  $w.Write([byte]$lado); $w.Write([byte]$lado); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$imagenes[$i].Length); $w.Write([uint32]$desplazamiento)
  $desplazamiento += $imagenes[$i].Length
}
foreach ($img in $imagenes) { $w.Write($img) }
$w.Flush()
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'exe') | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'exe\icono.ico'), $salida.ToArray())
[System.IO.File]::WriteAllBytes((Join-Path $raiz 'app\publico\icono.png'), $imagenes[-1])
'Icono creado.'
