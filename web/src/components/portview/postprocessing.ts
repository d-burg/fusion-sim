import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export interface PostProcessingPipeline {
  composer: EffectComposer
  bloomPass: UnrealBloomPass
  resize: (width: number, height: number, pixelRatio: number) => void
}

/**
 * Set up the post-processing pipeline with bloom and tone mapping.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostProcessingPipeline {
  const size = renderer.getSize(new THREE.Vector2())
  const pixelRatio = renderer.getPixelRatio()

  const composer = new EffectComposer(renderer)

  // Main render pass
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  // Bloom pass — selective bloom via emissive materials
  // Lower threshold (0.5) lets moderate brightness lines create subtle glow.
  // Higher strength (0.8) and radius (0.5) create the soft halo that
  // replaces Canvas 2D's multi-pass strokes at widths 9/6/3.5/1.5px.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.7,   // strength — soft glow halo
    0.4,   // radius — spread of glow
    0.6,   // threshold — catch bright plasma lines + glow sprites
  )
  composer.addPass(bloomPass)

  // Output pass (gamma correction)
  const outputPass = new OutputPass()
  composer.addPass(outputPass)

  const resize = (width: number, height: number, pr: number) => {
    composer.setSize(width, height)
    composer.setPixelRatio(pr)
    bloomPass.resolution.set(width, height)
  }

  return { composer, bloomPass, resize }
}
