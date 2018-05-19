package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io/ioutil"
	"log"
	"os"
)

func xyAddr(x int, y int) int {
	offset := (y & 7)
	row := (y / 8) & 7
	group := y / 64
	yAddr := 0x28*group + 0x80*row + 0x400*offset
	return yAddr + x/7
}

func addrXy(addr int) (int, int, bool) {
	if addr < 0 || addr > 0x1fff {
		return 0, 0, false
	}
	if addr%0x80 >= (0x28 * 3) {
		return 0, 0, false
	}

	x := ((addr % 0x80) % 0x28) * 7

	group := (addr % 0x80) / 0x28
	offset := addr / 0x400
	row := (addr - 0x28*group - 0x400*offset) / 0x80

	y := group*64 + row*8 + offset

	return x, y, true
}

func run(args []string) error {
	if len(args) != 2 {
		return errors.New("usage: hgr input output")
	}

	input, err := ioutil.ReadFile(args[0])
	if err != nil {
		return err
	}

	if len(input) != 0x2000 {
		return fmt.Errorf("expected to read 0x4000 bytes from file %q; read 0x%04x", args[0], len(input))
	}

	palette := color.Palette{color.Black, color.White}
	paletted := image.NewPaletted(image.Rect(0, 0, 560, 192), palette)
	_ = paletted

	for addr, val := range input {
		x, y, ok := addrXy(addr)
		if !ok {
			continue
		}
		x0 := x * 2
		if val&0x80 > 0 {
			x0 += 1
		}
		for b := 0; b < 7; b++ {
			c := color.Black
			if val&(1<<uint(b)) > 0 {
				c = color.White
			}
			paletted.Set(x0+2*b, y, c)
			paletted.Set(x0+2*b+1, y, c)
		}
	}

	f, err := os.Create(args[1])
	if err != nil {
		return err
	}

	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(f, paletted); err != nil {
		f.Close()
		return err
	}

	if err := f.Close(); err != nil {
		return err
	}

	_ = input

	return nil
}

func main() {
	err := run(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
}
