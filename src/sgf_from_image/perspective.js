'use strict'

// MEMO
// 
// Problem:
// From given [xi, yi] and [ui, vi] (i = 1,2,3,4)
// find a matrix R and numbers ci such that
// [xi, yi, 1] R = ci [ui, vi, 1].
// 
// Solution:
// Set c4 = 1 without loss of generality.
// Let 3-dim row vectors si = [xi, yi, 1], ti = [ui, vi, 1],
// and build 3x3 matrices S = [s1; s2; s3], T = [t1; t2; t3]
// from the above row vectors. (The first row of S is s1.)
// Further, let C = diag(c1, c2, c3) be 3x3 diagonal matrix.
// Then the given condition is S R = C T and s4 R = t4.
// So we obtain R = S^{-1} C T and s4 S^{-1} C T = t4.
// Hence s4 S^{-1} C = t4 T^{-1}.
// Namely, we get c1, c2, c3 as the ratio of elements between
// the row vectors p = s4 S^{-1} and q = t4 T^{-1}.
// 
// Calculation:
// $ echo '""; a: matrix([x1,y1,1],[x2,y2,1],[x3,y3,1]); d: determinant(a); d * (a^^-1), factor;' | maxima -q
//                          [ x1  y1  1 ]
//                          [           ]
// (%o2)                    [ x2  y2  1 ]
//                          [           ]
//                          [ x3  y3  1 ]
// (%o3)     x2 y3 + x1 (y2 - y3) - x3 y2 - (x2 - x3) y1
//       [  - (y3 - y2)        y3 - y1        - (y2 - y1)  ]
//       [                                                 ]
// (%o4) [    x3 - x2        - (x3 - x1)        x2 - x1    ]
//       [                                                 ]
//       [ x2 y3 - x3 y2  - (x1 y3 - x3 y1)  x1 y2 - x2 y1 ]

function perspective_transformer(...args) {

/////////////////////////////////////

// in: xyi = [xi,yi], uvi = [ui,vi]
// out: f() such that f([xi,yi]) = [ui,vi]
function transformer(xy1, xy2, xy3, xy4, uv1, uv2, uv3, uv4) {
    const ks = [0, 1, 2]
    const extend = a => [...a, 1]
    const [s1, s2, s3, s4, t1, t2, t3, t4] =
          [xy1, xy2, xy3, xy4, uv1, uv2, uv3, uv4].map(extend)
    const s_mat = [...s1, ...s2, ...s3], t_mat = [...t1, ...t2, ...t3]
    const s_inv = inv(xy1, xy2, xy3), t_inv = inv(uv1, uv2, uv3)
    const p = prod(s4, s_inv), q = prod(t4, t_inv)
    const c = ks.map(k => q[k] / p[k])
    const r_mat = mat_prod(s_inv, mat_prod(diag(c), t_mat))
    const f = xy => {
        const [u_, v_, w_] = prod(extend(xy), r_mat)
        return [u_ / w_, v_ / w_]
    }
    return f
}

// return [a, ..., i] such that the inverse matrix of
//   x1 y1 1
//   x2 y2 1
//   x3 y3 1
// is
//   a b c
//   d e f
//   g h i
function inv([x1,y1], [x2,y2], [x3,y3]) {
    const y12 = y1 - y2, y23 = y2 - y3, y31 = y3 - y1
    const det = x1 * y23 + x2 * y31 + x3 * y12
    const det_inv = [
        y23, y31, y12,
        x3 - x2, x1 - x3, x2 - x1,
        x2 * y3 - x3 * y2, x3 * y1 - x1 * y3, x1 * y2 - x2 * y1,
    ]
    return det_inv.map(z => z / det)
}

// vector-matrix product [x,y,z] A for A =
//   a11 a12 a13
//   a21 a22 a23
//   a31 a32 a33
function prod([x,y,z], [a11,a12,a13, a21,a22,a23, a31,a32,a33]) {
    return [x*a11+y*a21+z*a31, x*a12+y*a22+z*a32, x*a13+y*a23+z*a33]
}

// matrix-matrix product A B for A =
//   a11 a12 a13
//   a21 a22 a23
//   a31 a32 a33
// and similar B
function mat_prod([a11,a12,a13, a21,a22,a23, a31,a32,a33], b) {
    return [[a11,a12,a13], [a21,a22,a23], [a31,a32,a33]].flatMap(row => prod(row, b))
}

function diag([c1, c2, c3]) {return [c1,0,0, 0,c2,0, 0,0,c3]}

/////////////////////////////////////

return transformer(...args)

}

// EXAMPLE
// console.log(perspective_transformer([3,1],[4,1],[5,9],[2,6], [30,10],[40,10],[50,90],[20,60])([5,3]))
// ==> [50, 30]
// console.log(perspective_transformer([3,1],[4,1],[5,9],[2,6], [103,-101],[104,-101],[105,-109],[102,-106])([5,3]))
// ==> [105, -103]
