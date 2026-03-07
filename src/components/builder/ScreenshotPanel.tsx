/**
 * TORBIT Mobile - Screenshot Panel
 * Generate App Store screenshots from preview
 */

'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import NextImage from 'next/image'
import {
  Camera,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  Smartphone,
  RefreshCw,
  Eye
} from 'lucide-react'
import { useBuilderStore } from '@/store/builder'
import { TorbitSpinner } from '@/components/ui/TorbitLogo'
import { useEscapeToClose } from '@/hooks/useEscapeToClose'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { error as logError } from '@/lib/observability/logger.client'
import {
  SCREENSHOT_DEVICES,
  DEFAULT_SCREENSHOT_DEVICE,
  captureScreenshot,
  generateScreenshotZip,
  downloadScreenshotBlob,
  validateScreenshots,
  detectRoutesFromFiles,
  type ScreenshotDevice,
  type Screenshot,
  type DetectedRoute,
} from '@/lib/mobile/screenshots'

type ScreenshotStatus = 'idle' | 'detecting' | 'ready' | 'capturing' | 'complete' | 'error'

interface ScreenshotPanelProps {
  isOpen: boolean
  onClose: () => void
  previewRef: React.RefObject<HTMLElement | null>
}

export function ScreenshotPanel({ isOpen, onClose, previewRef }: ScreenshotPanelProps) {
  const [status, setStatus] = useState<ScreenshotStatus>('idle')
  const [selectedDevice, setSelectedDevice] = useState<ScreenshotDevice>(DEFAULT_SCREENSHOT_DEVICE)
  const [detectedRoutes, setDetectedRoutes] = useState<DetectedRoute[]>([])
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([])
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [currentCapture, setCurrentCapture] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  
  const { files, projectName } = useBuilderStore()
  
  // Detect routes when panel opens
  useEffect(() => {
    if (isOpen && status === 'idle') {
      setStatus('detecting')
      
      // Convert files to expected format
      const projectFiles = files.map(f => ({
        path: f.path,
        content: f.content,
      }))
      
      const routes = detectRoutesFromFiles(projectFiles)
      setDetectedRoutes(routes)
      
      // Auto-select first 3 routes or all if fewer
      setSelectedRoutes(routes.slice(0, Math.min(3, routes.length)).map(r => r.path))
      
      setStatus('ready')
    }
  }, [isOpen, status, files])
  
  // Toggle route selection
  const toggleRoute = useCallback((routePath: string) => {
    setSelectedRoutes(prev => 
      prev.includes(routePath)
        ? prev.filter(r => r !== routePath)
        : [...prev, routePath]
    )
  }, [])
  
  // Generate screenshots
  const handleGenerate = useCallback(async () => {
    if (!previewRef.current || selectedRoutes.length === 0) return
    
    setStatus('capturing')
    setError(null)
    setCurrentCapture(0)
    
    const newScreenshots: Screenshot[] = selectedRoutes.map((route, index) => {
      const routeInfo = detectedRoutes.find(r => r.path === route)
      return {
        id: `${route}-${index}`,
        name: routeInfo?.displayName || 'Screen',
        route,
        deviceId: selectedDevice.id,
        dataUrl: null,
        status: 'pending',
      }
    })
    
    setScreenshots(newScreenshots)
    
    try {
      // Capture each route
      for (let i = 0; i < newScreenshots.length; i++) {
        setCurrentCapture(i + 1)
        
        // Update status to capturing
        setScreenshots(prev => prev.map((s, idx) => 
          idx === i ? { ...s, status: 'capturing' } : s
        ))
        
        // Small delay between captures
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        
        try {
          // Capture the preview element
          const dataUrl = await captureScreenshot({
            element: previewRef.current,
            device: selectedDevice,
            backgroundColor: '#000000',
          })
          
          // Update with captured image
          setScreenshots(prev => prev.map((s, idx) => 
            idx === i ? { ...s, dataUrl, status: 'complete' } : s
          ))
        } catch (err) {
          logError('builder.screenshots.capture_failed', {
            route: newScreenshots[i]?.route,
            message: err instanceof Error ? err.message : 'Capture failed',
          })
          setScreenshots(prev => prev.map((s, idx) => 
            idx === i ? { 
              ...s, 
              status: 'error', 
              error: err instanceof Error ? err.message : 'Capture failed' 
            } : s
          ))
        }
      }
      
      setStatus('complete')
    } catch (err) {
      logError('builder.screenshots.generation_failed', {
        message: err instanceof Error ? err.message : 'Generation failed',
      })
      setError(err instanceof Error ? err.message : 'Generation failed')
      setStatus('error')
    }
  }, [previewRef, selectedRoutes, detectedRoutes, selectedDevice])
  
  // Download screenshots
  const handleDownload = useCallback(async () => {
    const completedScreenshots = screenshots.filter(s => s.status === 'complete' && s.dataUrl)
    if (completedScreenshots.length === 0) return
    
    try {
      const bundle = {
        sets: [{
          device: selectedDevice,
          screenshots: completedScreenshots,
        }],
        generatedAt: new Date().toISOString(),
      }
      
      const blob = await generateScreenshotZip(bundle)
      downloadScreenshotBlob(blob, projectName || 'MyApp')
    } catch (err) {
      logError('builder.screenshots.download_failed', {
        message: err instanceof Error ? err.message : 'Download failed',
      })
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }, [screenshots, selectedDevice, projectName])
  
  // Reset to start over
  const handleReset = useCallback(() => {
    setStatus('ready')
    setScreenshots([])
    setCurrentCapture(0)
    setError(null)
  }, [])
  
  // Close and reset
  const handleClose = useCallback(() => {
    setStatus('idle')
    setScreenshots([])
    setCurrentCapture(0)
    setError(null)
    setSelectedRoutes([])
    setDetectedRoutes([])
    onClose()
  }, [onClose])

  useEscapeToClose(isOpen, handleClose)
  useBodyScrollLock(isOpen)
  useFocusTrap(dialogRef, isOpen)
  
  // Validation
  const validation = validateScreenshots(screenshots)
  const completedCount = screenshots.filter(s => s.status === 'complete').length
  
  if (!isOpen) return null
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screenshot-dialog-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl mx-4 bg-black border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neutral-900 rounded-lg" aria-hidden="true">
              <Camera className="w-5 h-5 text-[#c0c0c0]" />
            </div>
            <div>
              <h2 id="screenshot-dialog-title" className="text-white font-semibold">App Store Screenshots</h2>
              <p className="text-neutral-500 text-sm">Generate ready-to-upload images</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close screenshot generator"
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-neutral-400" aria-hidden="true" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          
          {/* Detecting State */}
          {status === 'detecting' && (
            <div className="py-12 flex flex-col items-center gap-4">
              <TorbitSpinner size="lg" />
              <p className="text-neutral-400">Detecting screens...</p>
            </div>
          )}
          
          {/* Ready State - Select Screens */}
          {status === 'ready' && (
            <>
              {/* Device Selector */}
              <div className="space-y-2">
                <label id="device-selector-label" className="text-neutral-400 text-sm font-medium">Device Size</label>
                <div className="flex gap-2" role="radiogroup" aria-labelledby="device-selector-label">
                  {SCREENSHOT_DEVICES.map(device => (
                    <button
                      key={device.id}
                      onClick={() => setSelectedDevice(device)}
                      role="radio"
                      aria-checked={selectedDevice.id === device.id}
                      aria-label={`${device.name} ${device.displayName}. ${device.width} by ${device.height} pixels`}
                      className={`flex-1 p-3 rounded-xl border transition-colors ${
                        selectedDevice.id === device.id
                          ? 'bg-neutral-800 border-[#c0c0c0] text-white'
                          : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-600'
                      }`}
                    >
                      <Smartphone className="w-5 h-5 mx-auto mb-1" aria-hidden="true" />
                      <div className="text-sm font-medium">{device.name}</div>
                      <div className="text-xs text-neutral-500">{device.displayName}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Screen Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label id="screen-selector-label" className="text-neutral-400 text-sm font-medium">
                    Screens to Capture ({selectedRoutes.length} selected)
                  </label>
                  {detectedRoutes.length > 0 && (
                    <button
                      onClick={() => setSelectedRoutes(
                        selectedRoutes.length === detectedRoutes.length
                          ? []
                          : detectedRoutes.map(r => r.path)
                      )}
                      aria-label={selectedRoutes.length === detectedRoutes.length ? 'Deselect all screens' : 'Select all screens'}
                      className="text-xs text-[#c0c0c0] hover:text-white"
                    >
                      {selectedRoutes.length === detectedRoutes.length ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>
                
                {detectedRoutes.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto" role="group" aria-labelledby="screen-selector-label">
                    {detectedRoutes.map(route => (
                      <button
                        key={route.path}
                        onClick={() => toggleRoute(route.path)}
                        role="checkbox"
                        aria-checked={selectedRoutes.includes(route.path)}
                        aria-label={`${route.displayName} screen at ${route.path}. ${selectedRoutes.includes(route.path) ? 'Selected' : 'Not selected'}`}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                          selectedRoutes.includes(route.path)
                            ? 'bg-neutral-800 border-[#c0c0c0]'
                            : 'bg-neutral-900 border-neutral-700 hover:border-neutral-600'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          selectedRoutes.includes(route.path)
                            ? 'bg-[#c0c0c0] border-[#c0c0c0]'
                            : 'border-neutral-600'
                        }`} aria-hidden="true">
                          {selectedRoutes.includes(route.path) && (
                            <CheckCircle2 className="w-3 h-3 text-black" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-white text-sm font-medium">{route.displayName}</div>
                          <div className="text-neutral-500 text-xs">{route.path}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-lg text-center">
                    <p className="text-neutral-400 text-sm">No screens detected</p>
                    <p className="text-neutral-500 text-xs mt-1">
                      The current preview will be captured
                    </p>
                  </div>
                )}
              </div>
              
              {/* Info Note */}
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <Eye className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-blue-400 text-sm">
                    <p className="font-medium">How it works</p>
                    <p className="text-blue-400/70 text-xs mt-0.5">
                      Screenshots are captured from the current preview state. 
                      Navigate to different screens in the preview before capturing for variety.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={selectedRoutes.length === 0 && detectedRoutes.length > 0}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#c0c0c0] hover:bg-white text-black font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Camera className="w-4 h-4" />
                Capture {selectedRoutes.length > 0 ? selectedRoutes.length : 1} Screenshot{selectedRoutes.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          
          {/* Capturing State */}
          {status === 'capturing' && (
            <div className="space-y-4">
              <div className="py-8 flex flex-col items-center gap-4">
                <TorbitSpinner size="xl" />
                <div className="text-center">
                  <p className="text-white font-medium">Capturing Screenshots</p>
                  <p className="text-neutral-500 text-sm mt-1">
                    {currentCapture} of {screenshots.length}
                  </p>
                </div>
              </div>
              
              {/* Progress */}
              <div className="space-y-2">
                {screenshots.map((screenshot) => (
                  <div 
                    key={screenshot.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      screenshot.status === 'capturing' 
                        ? 'bg-neutral-800 border-[#c0c0c0]' 
                        : screenshot.status === 'complete'
                          ? 'bg-emerald-500/10 border-emerald-500/20'
                          : 'bg-neutral-900 border-neutral-800'
                    }`}
                  >
                    {screenshot.status === 'pending' && (
                      <div className="w-5 h-5 rounded-full border-2 border-neutral-600" />
                    )}
                    {screenshot.status === 'capturing' && (
                      <TorbitSpinner size="xs" speed="fast" />
                    )}
                    {screenshot.status === 'complete' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    )}
                    {screenshot.status === 'error' && (
                      <X className="w-5 h-5 text-red-500" />
                    )}
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${
                        screenshot.status === 'complete' ? 'text-emerald-400' : 'text-neutral-300'
                      }`}>
                        {screenshot.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Complete State */}
          {status === 'complete' && (
            <div className="space-y-4">
              {/* Success Banner */}
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                <div>
                  <p className="text-emerald-400 font-medium">
                    {completedCount} Screenshot{completedCount !== 1 ? 's' : ''} Ready
                  </p>
                  <p className="text-emerald-500/60 text-sm mt-0.5">
                    Ready for App Store Connect
                  </p>
                </div>
              </div>
              
              {/* Validation Warnings */}
              {validation.warnings.length > 0 && (
                <div className="space-y-2">
                  {validation.warnings.map((warning, index) => (
                    <div key={index} className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <div className="flex items-center gap-2 text-amber-400 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        {warning}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Screenshot Previews */}
              <div className="grid grid-cols-3 gap-3">
                {screenshots.filter(s => s.status === 'complete' && s.dataUrl).map(screenshot => (
                  <div 
                    key={screenshot.id}
                    className="relative aspect-[9/19.5] bg-neutral-900 rounded-lg overflow-hidden border border-neutral-800"
                  >
                    <NextImage
                      src={screenshot.dataUrl!}
                      alt={screenshot.name}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 1024px) 33vw, 220px"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-xs font-medium truncate">
                        {screenshot.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Device Info */}
              <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg">
                <div className="flex items-center gap-2 text-neutral-400 text-sm">
                  <Smartphone className="w-4 h-4" />
                  <span>{selectedDevice.name}</span>
                  <span className="text-neutral-600">•</span>
                  <span>{selectedDevice.width} × {selectedDevice.height}</span>
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-xl transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Capture More
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#c0c0c0] hover:bg-white text-black font-medium rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download Screenshots
                </button>
              </div>
            </div>
          )}
          
          {/* Error State */}
          {status === 'error' && (
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="p-4 bg-red-500/10 rounded-2xl">
                <X className="w-8 h-8 text-red-500" />
              </div>
              <div className="text-center">
                <p className="text-white font-medium">Capture Failed</p>
                <p className="text-neutral-400 text-sm mt-1">{error || 'An unexpected error occurred'}</p>
              </div>
              <button
                onClick={handleReset}
                className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
          
        </div>
      </div>
    </div>
  )
}
